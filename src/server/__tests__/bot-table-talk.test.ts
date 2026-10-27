import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { buildScenario } from "@/engine/scenario";
import { PRESETS } from "@/engine/scenarios";
import { applyAction, viewFor } from "@/engine/game";
import { openChat } from "@/lib/chatAuth";
import { movePublicKey } from "../moveSigning";
import { talkDue } from "@/lib/bots/tableTalk";
import type { Action, GameState } from "@/engine/types";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), chat: vi.fn(), after: vi.fn(), broadcast: vi.fn() }));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("../push", () => ({ scheduleTurnNotification: vi.fn() }));
vi.mock("../history", () => ({ recordGameResult: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: mocks.from, rpc: mocks.rpc }) }));
vi.mock("../tables", () => ({ tableByCode: async () => ({ id: "table-id", code: "ABC234", current_game_id: "game-id", status: "playing" }) }));
vi.mock("../realtime", () => ({ broadcastTable: mocks.broadcast, broadcastChat: mocks.chat }));
vi.mock("../settings", () => ({ getSettings: async () => (await import("@/lib/settings")).DEFAULT_SETTINGS }));
vi.mock("../limits", () => ({ enforce: async () => {} }));
import { act, botTick } from "../game";
import { scheduleHandTalk, scheduleRematchTalk } from "../botTableTalk";

let state: GameState;
let seat: number;
let callbacks: (() => Promise<void>)[];
let duplicate: boolean;
let humanFinal: boolean;
const flush = async () => { for (const callback of callbacks) await callback(); };
beforeEach(() => {
  vi.clearAllMocks(); callbacks = []; duplicate = false; humanFinal = false;
  mocks.after.mockImplementation(callback => callbacks.push(callback));
  const spec = PRESETS.find(p => p.id === "claim-all")!.spec;
  state = buildScenario({ ...spec, bidder: 1, dealer: 0, rules: { ...spec.rules, target: 99999 },
    hands: { 1: spec.hands![0], 2: ["JS1"], 3: ["9S0"], 0: ["9S1"] } }).state;
  state.handNumber = [3, 4].find(n => talkDue("table-id", n))!; seat = 1;
  mocks.from.mockImplementation((table: string) => {
    const result = { data: table === "seats" ? [{ seat: humanFinal ? (seat + 1) % 4 : seat, user_id: null, bot: "Otto", profile: null }, { seat: (seat + 2) % 4, user_id: "human", bot: null, profile: { display_name: "Margaret" } }]
      : table === "game_actions" ? duplicate ? { id: "prior" } : null : { id: "game-id", state, rev: state.rev }, error: null };
    const query = { select: () => query, eq: () => query, abortSignal: () => query,
      maybeSingle: async () => table === "seats" ? { data: { seat }, error: null } : result,
      single: async () => ({ data: { rev: state.rev + 1 }, error: null }), then: (resolve: (value: unknown) => void) => Promise.resolve(result).then(resolve) };
    return query;
  });
  mocks.rpc.mockResolvedValue({ data: state.rev + 1, error: null });
  mocks.chat.mockResolvedValue(undefined);
  vi.stubEnv("CRON_SECRET", "test-only");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-only");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-only");
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

it("only the winning scoring commit schedules one chat despite concurrent ticks", async () => {
  mocks.rpc.mockResolvedValueOnce({ data: state.rev + 1, error: null }).mockResolvedValueOnce({ data: null, error: null });
  await Promise.all([botTick("ABC234"), botTick("ABC234")]);
  expect(callbacks).toHaveLength(1);
  expect(mocks.chat).not.toHaveBeenCalled();
  await flush();
  expect(mocks.chat).toHaveBeenCalledTimes(1);
  expect(mocks.chat.mock.calls[0][0]).toBe("ABC234");
  const signed = mocks.chat.mock.calls[0][1];
  expect(await openChat(movePublicKey(), "ABC234", signed.message, signed.sig)).toEqual({
    id: `bot:game-id:hand:${state.handNumber}`, from: "bot:table-id:1", name: "Otto", text: expect.any(String), at: expect.any(Number),
  });
});
it("a human's final card triggers chatter, but duplicate action requests do not", async () => {
  state = buildScenario({ to: "playing", tricks: 11, plays: 3, rules: { target: 99999 } }).state;
  state.handNumber = [3, 4].find(n => talkDue("table-id", n))!;
  seat = state.turn!; humanFinal = true;
  const action: Action = { type: "play_card", seat: state.turn!, card: viewFor(state, state.turn!).legal.playableCards[0] };
  await expect(act("ABC234", "human", action, state.rev, "request")).resolves.toMatchObject({ phase: "hand_over" });
  duplicate = true;
  await act("ABC234", "human", action, state.rev, "request");
  expect(callbacks).toHaveLength(1);
  await flush(); expect(mocks.chat).toHaveBeenCalledTimes(1);
});
it("a failed or pending chat cannot delay or fail the committed action", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.chat.mockRejectedValue(new Error("offline"));
  await expect(botTick("ABC234")).resolves.toMatchObject({ acted: true });
  expect(mocks.chat).not.toHaveBeenCalled();
  await expect(flush()).resolves.toBeUndefined();
  expect(log).toHaveBeenCalledWith("Bot table talk failed", expect.any(Error));
});
it("even a scheduling failure cannot fail an action", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.after.mockImplementation(() => { throw new Error("no request context"); });
  await expect(botTick("ABC234")).resolves.toMatchObject({ acted: true });
});
it("does not schedule on an ordinary move, first hand, or next-hand acknowledgement", () => {
  const next = applyAction(state, { type: "claim", seat: 1 });
  scheduleHandTalk({ id: "table-id", code: "ABC234" }, "game-id", state, state, { type: "claim", seat: 1 });
  scheduleHandTalk({ id: "table-id", code: "ABC234" }, "game-id", { ...state, handNumber: 1 }, next, { type: "claim", seat: 1 });
  scheduleHandTalk({ id: "table-id", code: "ABC234" }, "game-id", next, applyAction(next, { type: "next_hand", seat: 1 }), { type: "next_hand", seat: 1 });
  expect(callbacks).toHaveLength(0);
});
it("handles public redeals and rematches without reading the new deal", async () => {
  const prev = { ...state, phase: "bidding" as const };
  const next = { ...prev, handNumber: prev.handNumber + 1 };
  scheduleHandTalk({ id: "table-id", code: "ABC234" }, "game-id", prev, next, { type: "misdeal", seat: 1 });
  scheduleRematchTalk({ id: "table-id", code: "ABC234" }, "old-game");
  expect(callbacks).toHaveLength(2);
  await flush(); expect(mocks.chat).toHaveBeenCalledTimes(2);
});
it("stays quiet at human-only tables", async () => {
  mocks.from.mockReturnValue({ select: () => ({ eq: () => ({ abortSignal: async () => ({ data: [], error: null }) }) }) });
  scheduleRematchTalk({ id: "table-id", code: "ABC234" }, "old-game");
  await flush(); expect(mocks.chat).not.toHaveBeenCalled();
});

it("never reads hands, private pass buffers or the deal seed for chatter", async () => {
  const next = applyAction(state, { type: "claim", seat: 1 });
  for (const snapshot of [state, next]) {
    for (const key of ["players", "seed"]) Object.defineProperty(snapshot, key, { get() { throw new Error(`Private read: ${key}`); } });
  }
  scheduleHandTalk({ id: "table-id", code: "ABC234" }, "game-id", state, next, { type: "claim", seat: 1 });
  expect(callbacks).toHaveLength(1);
  await flush(); expect(mocks.chat).toHaveBeenCalledTimes(1);
});
it("a duplicate detected inside the human commit schedules nothing", async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: null });
  await act("ABC234", "human", { type: "claim", seat: 1 }, state.rev, "request");
  expect(callbacks).toHaveLength(0);
});
