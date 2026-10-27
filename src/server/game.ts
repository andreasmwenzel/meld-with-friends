import "server-only";
import { scheduleTurnNotification } from "./push";
import { bump } from "./metrics";
import { getSettings } from "./settings";
import { enforce } from "./limits";
import { chooseAction } from "@/engine/ai";
import { applyAction, viewFor } from "@/engine";
import { publicMove } from "@/engine/publicMove";
import { movePublicKey, signMove } from "./moveSigning";
import { BUILD_ID } from "@/lib/staleClient";
import type { Action, GameState, PlayerView, SeatIndex } from "@/engine/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { ApiError, checkDb } from "./errors";
import { tableByCode } from "./tables";
import { broadcastTable, type GameEvent } from "./realtime";
import { recordGameResult } from "./history";

async function loadGame(code: string, userId: string) {
  const table = await tableByCode(code);
  const admin = createAdminClient();
  const { data: seat, error: seatError } = await admin.from("seats").select("seat").eq("table_id", table.id).eq("user_id", userId).maybeSingle();
  checkDb(seatError);
  if (!seat) throw new ApiError(403, "You must be seated to view or play this game");
  if (!table.current_game_id) throw new ApiError(404, "Game has not started");
  const { data: game, error } = await admin.from("games").select("id,state,rev,ready").eq("id", table.current_game_id).maybeSingle();
  checkDb(error);
  if (!game) throw new ApiError(404, "Game has not started");
  return { table, seat: seat.seat as SeatIndex, game: game as { id: string; state: GameState; rev: number; ready?: SeatIndex[] } };
}

/** A seat's view plus table facts; `moveKey` is the public key that checks the moves broadcast for the game,
 *  `build` the deploy that answered (see src/lib/staleClient.ts). */
export type TablePlayerView = PlayerView & { ready: SeatIndex[]; moveKey: string; build: string };

export async function getView(code: string, userId: string): Promise<TablePlayerView> {
  const { seat, game } = await loadGame(code, userId);
  return { ...viewFor(game.state, seat), ready: game.ready ?? [], moveKey: movePublicKey(), build: BUILD_ID };
}

export async function act(code: string, userId: string, action: Action, expectedRev: number, requestId: string): Promise<TablePlayerView> {
  const { table, seat, game } = await loadGame(code, userId);
  if (table.paused_by) throw new ApiError(409, "The table is paused.");
  if (action.seat !== seat) throw new ApiError(403, "Action seat does not belong to you");
  const admin = createAdminClient();
  const prior = await admin.from("game_actions").select("id").eq("game_id", game.id).eq("request_id", requestId).maybeSingle();
  checkDb(prior.error);
  if (prior.data) return getView(code, userId);
  if (table.status !== "playing") throw new ApiError(409, "Table is not playing");
  if (expectedRev !== game.rev) {
    bump("act_conflict");
    throw new ApiError(409, "Game changed", { ...viewFor(game.state, seat), ready: game.ready ?? [], moveKey: movePublicKey(), build: BUILD_ID });
  }
  if (action.type === "next_hand" && game.state.phase === "hand_over" && table.host !== userId) {
    const result = await admin.from("seats").select("seat,user_id").eq("table_id", table.id);
    checkDb(result.error);
    if ((result.data ?? []).some(s => s.user_id && !(game.ready ?? []).includes(s.seat))) {
      throw new ApiError(409, "Every human must be ready for the next hand.");
    }
  }
  await enforce(`actions:${userId}`, (await getSettings()).limits.actionsPerHour, 3600);
  const next = applyAction(game.state, action);
  // The revision guard and audit insert run in one database transaction.
  const { data: committed, error } = await admin.rpc("commit_game_action", {
    p_game: game.id, p_user: userId, p_old_rev: game.rev, p_state: next, p_action: action, p_request_id: requestId,
  });
  if (error?.message === "The table is paused.") throw new ApiError(409, error.message);
  if (isStaleCommit(error)) {
    if (error.message.startsWith("Game changed")) bump("act_conflict");
    throw new ApiError(409, "Game changed", await getView(code, userId));
  }
  checkDb(error);
  if (committed === null) return getView(code, userId);
  scheduleTurnNotification(game.id);
  if (next.phase === "game_over") void recordGameResult(game.id).catch(error => console.error("Game result recording failed", error));
  await broadcastTable(table.code, gameEvent(game.id, game.state, next, action));
  if (next.phase === "melding") {
    await runBotTick(code, true);
    return getView(code, userId);
  }
  return { ...viewFor(next, seat), ready: next.phase === "hand_over" ? game.ready ?? [] : [], moveKey: movePublicKey(), build: BUILD_ID };
}

/**
 * The game broadcast for a committed move. When nothing private changed it carries the signed public
 * move, so seated clients apply it without fetching; otherwise (or if signing fails) just the revision.
 */
export function gameEvent(gameId: string, prev: GameState, next: GameState, action: Action): GameEvent {
  const event: GameEvent = { type: "game", rev: next.rev };
  try {
    const move = publicMove(prev, next, action);
    return move ? { ...event, ...signMove(gameId, move) } : event;
  } catch (error) { console.error("Public move failed", error); return event; }
}

/**
 * The commit lost a revision or table race. Migration 0017 raises these as PT409 (40001 is retried by
 * the database API); 40001 is still accepted until that migration is applied everywhere.
 */
function isStaleCommit(error: { code?: string; message: string } | null): error is { code?: string; message: string } {
  return error?.code === "40001" || (error?.code === "PT409"
    && (error.message.startsWith("Game changed") || error.message.startsWith("Table is not playing")));
}

/** Service-only worker. The HTTP route verifies the caller is a seated human. */
export async function botTick(code: string): Promise<{ acted: boolean; rev: number }> {
  return runBotTick(code, false);
}
async function runBotTick(code: string, meldingOnly: boolean): Promise<{ acted: boolean; rev: number }> {
  bump("tick");
  try {
    const result = await performBotTick(code, meldingOnly);
    if (!result.acted) bump("tick_noop");
    return result;
  } catch (error) {
    bump("tick_fail");
    throw error;
  }
}
async function performBotTick(code: string, meldingOnly: boolean): Promise<{ acted: boolean; rev: number }> {
  const table = await tableByCode(code);
  if (table.paused_by) throw new ApiError(409, "The table is paused.");
  const settings = await getSettings();
  await enforce(`ticks:${table.id}`, settings.limits.ticksPerTablePerHour, 3600);
  const admin = createAdminClient();
  if (!table.current_game_id) throw new ApiError(404, "Game has not started");
  const [seatsResult, gameResult] = await Promise.all([
    admin.from("seats").select("seat,bot,user_id").eq("table_id", table.id),
    admin.from("games").select("id,state,rev,ready").eq("id", table.current_game_id).maybeSingle(),
  ]);
  checkDb(seatsResult.error); checkDb(gameResult.error);
  if (!gameResult.data) throw new ApiError(404, "Game has not started");
  const game = gameResult.data as { id: string; state: GameState; rev: number; ready?: SeatIndex[] };
  let state = game.state;
  let acted = false;
  if (table.status !== "playing") return { acted, rev: game.rev };
  const bots = (seatsResult.data ?? []).filter(s => s.bot && !s.user_id).map(s => s.seat as SeatIndex);
  if ((meldingOnly && state.phase !== "melding") || state.phase === "hand_over" || state.phase === "game_over") return { acted, rev: game.rev };
  const melding = state.phase === "melding";
  const actions: Action[] = melding ? bots.filter(seat => !state.players[seat].meldConfirmed).flatMap(seat => [
    { type: "declare_meld", seat, cards: [...state.players[seat].hand] } as Action,
    { type: "confirm_meld", seat } as Action,
  ]) : state.turn !== null && bots.includes(state.turn) ? [chooseAction(viewFor(state, state.turn), { seed: `${game.id}:${state.rev}`, config: settings.bots })] : [];
  for (const action of actions) {
    const next = applyAction(state, action);
    const { data: committedRev, error } = await admin.rpc("commit_bot_action", { p_game: game.id, p_old_rev: state.rev, p_state: next, p_action: action });
    if (error?.message === "The table is paused.") throw new ApiError(409, error.message);
    if (isStaleCommit(error) || (!error && committedRev === null)) {
      const current = await admin.from("games").select("rev").eq("id", game.id).single();
      checkDb(current.error);
      return { acted: false, rev: current.data!.rev };
    }
    checkDb(error);
    if (next.phase === "game_over") void recordGameResult(game.id).catch(error => console.error("Game result recording failed", error));
    scheduleTurnNotification(game.id);
    await broadcastTable(table.code, gameEvent(game.id, state, next, action));
    state = next; acted = true;
  }
  return { acted, rev: state.rev };
}
export async function tickForHuman(code: string, userId: string) {
  await loadGame(code, userId);
  return { ...await botTick(code), delayMs: (await getSettings()).bots.tickDelayMs };
}
