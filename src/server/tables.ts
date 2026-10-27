import "server-only";
import { bump } from "./metrics";
import { getSettings } from "./settings";
import { enforce } from "./limits";
import { resolveRules } from "@/engine/scoring";
import { newGame } from "@/engine";
import type { GameState, RulesConfig, SeatIndex } from "@/engine/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateTableCode } from "@/lib/codes";
import { ApiError, checkDb } from "./errors";
import { broadcastTable } from "./realtime";
import { scheduleRematchTalk } from "./botTableTalk";
import { codeSchema, rulesSchema } from "./validation";

export interface PausedTable { by: string; name: string; reason: string | null; at: string }

export interface TableRow {
  paused_by?: string | null; paused_reason?: string | null; paused_at?: string | null;
  id: string; code: string; host: string; game_kind: "pinochle";
  status: "open" | "playing" | "finished"; current_game_id: string | null; rules: Partial<RulesConfig>; created_at: string;
}
export interface Profile { id: string; handle: string; display_name: string; avatar_seed: string; created_at: string }
export interface Seat { table_id: string; seat: SeatIndex; user_id: string | null; bot: string | null; profile: Profile | null }
export interface TradeOffer { id: string; table_id: string; from_user: string; to_user: string; from_seat: SeatIndex; to_seat: SeatIndex; status: string; created_at: string }

export async function tableByCode(code: string): Promise<TableRow> {
  const { data, error } = await createAdminClient().from("tables").select("*").eq("code", codeSchema.parse(code)).maybeSingle();
  checkDb(error);
  if (!data) throw new ApiError(404, "Table not found");
  return { ...data, rules: resolveRules(data.rules) } as TableRow;
}

/**
 * Deals a new table. With a group, the database seats the host in the first chair and invites the
 * group in the same transaction (deal_for_group), so the host is never locked out and never gets a
 * table whose invitations failed.
 */
export async function createTable(gameKind: "pinochle", rules: Partial<RulesConfig>, userId: string, groupId?: string): Promise<TableRow & { invited?: string[] }> {
  const { limits } = await getSettings();
  await enforce(`tables:${userId}`, limits.tablesPerHour, 3600);
  const admin = createAdminClient();
  const count = await admin.from("tables").select("id", { count: "exact", head: true }).eq("host", userId).neq("status", "finished");
  checkDb(count.error);
  if ((count.count ?? 0) >= limits.maxOpenTablesPerHost) { bump("rate_limited"); throw new ApiError(429, "Slow down: too many unfinished tables"); }
  for (let attempt = 0; attempt < 8; attempt++) {
    const args = { p_code: generateTableCode(), p_user: userId, p_kind: gameKind, p_rules: resolveRules(rulesSchema.parse(rules)) };
    const { data, error } = groupId
      ? await admin.rpc("deal_for_group", { ...args, p_group: groupId })
      : await admin.rpc("create_table", args);
    if (error?.code === "23505") continue;
    checkDb(error);
    if (!groupId) return data as TableRow;
    const dealt = data as { table: TableRow; invited: string[] };
    return { ...dealt.table, invited: dealt.invited };
  }
  throw new ApiError(503, "Could not allocate a table code; retry");
}

export async function joinTable(code: string, userId: string) {
  return getTableSnapshot(code, userId);
}

export async function updateTableRules(code: string, rules: Partial<RulesConfig>, userId: string) {
  const table = await tableByCode(code);
  if (table.host !== userId) throw new ApiError(403, "Only the host may change rules");
  if (table.status !== "open") throw new ApiError(409, "Rules can only change while the table is open");
  const validatedRules = rulesSchema.parse(rules);
  const { data, error } = await createAdminClient().from("tables")
    .update({ rules: resolveRules(validatedRules) }).eq("id", table.id).eq("host", userId).eq("status", "open")
    .select("id").maybeSingle();
  checkDb(error);
  if (!data) throw new ApiError(409, "Table changed before rules could be updated");
  await broadcastTable(table.code, { type: "seats" });
  return getTableSnapshot(table.code, userId);
}

export async function takeSeat(code: string, seat: SeatIndex, userId: string) {
  const table = await tableByCode(code);
  const { error } = await createAdminClient().rpc("take_seat", { table_id: table.id, seat, user_id: userId });
  checkDb(error);
  await broadcastTable(table.code, { type: "seats" });
  await broadcastTable(table.code, { type: "trade" });
  return getTableSnapshot(table.code, userId);
}

export async function leaveSeat(code: string, userId: string) {
  const table = await tableByCode(code);
  const { error } = await createAdminClient().rpc("leave_seat", { p_table: table.id, p_user: userId });
  checkDb(error);
  await broadcastTable(table.code, { type: "seats" });
  await broadcastTable(table.code, { type: "trade" });
  return getTableSnapshot(table.code, userId);
}

export async function offerSeatTrade(code: string, toUserId: string, userId: string) {
  const table = await tableByCode(code);
  const { data, error } = await createAdminClient().rpc("offer_seat_trade", { p_table: table.id, p_user: userId, p_to: toUserId });
  checkDb(error);
  await broadcastTable(table.code, { type: "trade" });
  return data as TradeOffer;
}

export async function answerSeatTrade(offerId: string, accept: boolean, userId: string) {
  const { data, error } = await createAdminClient().rpc("answer_seat_trade", { p_offer: offerId, p_user: userId, p_accept: accept });
  checkDb(error);
  const code = data as string;
  await broadcastTable(code, { type: "trade" });
  if (accept) await broadcastTable(code, { type: "seats" });
  return getTableSnapshot(code, userId);
}

export async function startGame(code: string, userId: string) {
  const table = await tableByCode(code);
  if (table.host !== userId) throw new ApiError(403, "Only the host may start");
  const state = newGame(crypto.randomUUID(), table.rules);
  const { error } = await createAdminClient().rpc("start_game", { p_table: table.id, p_user: userId, p_state: state });
  checkDb(error);
  await broadcastTable(table.code, { type: "game", rev: state.rev });
  await broadcastTable(table.code, { type: "trade" });
  // Never return the full engine state to a browser.
  return { code: table.code, rev: state.rev };
}

export async function getTableSnapshot(code: string, userId: string) {
  const table = await tableByCode(code);
  const admin = createAdminClient();
  const [seatResult, offerResult] = await Promise.all([
    admin.from("seats").select("*, profile:profiles(*)").eq("table_id", table.id).order("seat"),
    admin.from("seat_trade_offers").select("*").eq("table_id", table.id).eq("status", "pending").order("created_at"),
  ]);
  checkDb(seatResult.error); checkDb(offerResult.error);
  const seats = seatResult.data as unknown as Seat[];
  const mySeat = seats.find(seat => seat.user_id === userId)?.seat ?? null;
  // Knowing the code permits a preview; only members can inspect trade offers.
  const offers = table.host === userId || mySeat !== null ? offerResult.data as TradeOffer[] : [];
  let ready: SeatIndex[] = [];
  if (table.current_game_id) {
    const result = await admin.from("games").select("ready").eq("id", table.current_game_id).maybeSingle();
    checkDb(result.error);
    ready = result.data?.ready ?? [];
  }
  let paused: PausedTable | null = null;
  if (table.paused_by && table.paused_at) {
    const result = await admin.from("profiles").select("display_name").eq("id", table.paused_by).maybeSingle();
    checkDb(result.error);
    paused = { by: table.paused_by, name: result.data?.display_name ?? "Player", reason: table.paused_reason ?? null, at: table.paused_at };
  }
  let lastSeenRev: number | null = null;
  if (mySeat !== null) {
    const visit = await admin.from("table_visits").select("last_rev").eq("table_id", table.id).eq("user_id", userId).maybeSingle();
    checkDb(visit.error);
    lastSeenRev = visit.data?.last_rev ?? null;
  }
  return { table, seats, offers, mySeat, ready, paused, lastSeenRev };
}

async function manageBots(code: string, userId: string, mode: "add" | "remove" | "fill", seat?: SeatIndex) {
  const table = await tableByCode(code);
  const { error } = await createAdminClient().rpc("manage_bots", { p_table: table.id, p_user: userId, p_mode: mode, p_seat: seat ?? null });
  checkDb(error);
  await broadcastTable(table.code, { type: "seats" });
  return getTableSnapshot(table.code, userId);
}
export const addBot = (code: string, seat: SeatIndex, userId: string) => manageBots(code, userId, "add", seat);
export const removeBot = (code: string, seat: SeatIndex, userId: string) => manageBots(code, userId, "remove", seat);
export const fillBots = (code: string, userId: string) => manageBots(code, userId, "fill");

export async function rematch(code: string, userId: string) {
  const table = await tableByCode(code);
  if (table.host !== userId) throw new ApiError(403, "Only the host may rematch");
  if (!table.current_game_id) throw new ApiError(409, "Game has not started");
  const admin = createAdminClient();
  const { data: game, error: gameError } = await admin.from("games").select("id,state")
    .eq("id", table.current_game_id).maybeSingle();
  checkDb(gameError);
  if (!game) throw new ApiError(409, "Game has not started");
  const previous = game.state as GameState;
  if (table.status !== "finished" && previous.phase !== "game_over") throw new ApiError(409, "Game is still in progress");
  const state = newGame(crypto.randomUUID(), table.rules, ((previous.dealer + 1) % 4) as SeatIndex);
  const { error } = await admin.rpc("rematch_game", {
    p_table: table.id, p_user: userId, p_previous: game.id, p_rules: table.rules, p_state: state,
  });
  checkDb(error);
  scheduleRematchTalk(table, game.id);
  await broadcastTable(table.code, { type: "seats" });
  await broadcastTable(table.code, { type: "game", rev: state.rev });
  return { code: table.code, rev: state.rev };
}

export async function standIn(code: string, seat: SeatIndex, userId: string) {
  const table = await tableByCode(code);
  if (table.host !== userId) throw new ApiError(403, "Only the host may replace a player");
  if (table.status !== "playing") throw new ApiError(409, "Table is not playing");
  const { error } = await createAdminClient().rpc("stand_in", { p_table: table.id, p_user: userId, p_seat: seat });
  checkDb(error);
  await broadcastTable(table.code, { type: "seats" });
  return getTableSnapshot(table.code, userId);
}

/** Mutations serialize with action commits on the parent table row. */
export async function controlTable(code: string, userId: string, operation: "ready" | "pause" | "resume" | "host", value?: string) {
  const table = await tableByCode(code);
  const { error } = await createAdminClient().rpc("control_table", {
    p_table: table.id, p_user: userId, p_operation: operation, p_value: value ?? null,
  });
  checkDb(error);
  await broadcastTable(table.code, { type: "seats" });
  return getTableSnapshot(table.code, userId);
}
