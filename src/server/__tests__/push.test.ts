import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { newGame } from "@/engine/game";
import type { GameState } from "@/engine/types";
const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), send: vi.fn(), bump: vi.fn(), after: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: mocks.from, rpc: mocks.rpc }) }));
vi.mock("web-push", () => ({ default: { sendNotification: mocks.send } }));
vi.mock("../metrics", () => ({ bump: mocks.bump }));
vi.mock("next/server", () => ({ after: mocks.after }));
import { notifyTurn, scheduleTurnNotification } from "../push";
let state: GameState;
let table: Record<string, unknown>;
let seats: { seat: number; user_id: string | null; bot: string | null }[];
let visit: { last_seen: string } | null;
let subscriptions: { endpoint: string; keys: { p256dh: string; auth: string } }[];
let claimed: boolean;
let deletes: string[];
let updates: string[];
function query(result: unknown) {
  const q = {
    abortSignal: () => q,
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
  };
  return q;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("VAPID_PUBLIC_KEY", "public"); vi.stubEnv("VAPID_PRIVATE_KEY", "private"); vi.stubEnv("VAPID_SUBJECT", "mailto:test@example.com");
  state = newGame("push"); state.phase = "bidding"; state.turn = 1;
  table = { id: "table", code: "BCDFGH", rules: { pace: "leisurely" }, current_game_id: "game", status: "playing" };
  seats = [{ seat: 1, user_id: "human", bot: null }];
  visit = null; claimed = true; deletes = []; updates = [];
  subscriptions = [{ endpoint: "https://fcm.googleapis.com/sub", keys: { p256dh: "key", auth: "auth" } }];
  mocks.send.mockResolvedValue({ statusCode: 201 });
  mocks.rpc.mockImplementation(() => query({ data: claimed, error: null }));
  mocks.from.mockImplementation((name: string) => {
    let operation = "read";
    const filters: Record<string, unknown> = {};
    const result = () => ({ error: null, data: operation !== "read" ? null : name === "games" ? { table_id: "table", state } : name === "tables" ? table : name === "seats" ? seats : name === "table_visits" ? visit : subscriptions });
    const q = {
      select: () => q, eq: (key: string, value: unknown) => { filters[key] = value; return q; }, abortSignal: () => q,
      delete: () => { operation = "delete"; return q; }, update: () => { operation = "update"; return q; },
      maybeSingle: async () => result(),
      then: (resolve: (value: unknown) => unknown) => {
        if (operation === "delete") deletes.push(String(filters.endpoint));
        if (operation === "update") updates.push(String(filters.endpoint));
        return Promise.resolve(result()).then(resolve);
      },
    };
    return q;
  });
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
it("sends an absent human their phase prompt and records success", async () => {
  await notifyTurn("game");
  expect(mocks.send).toHaveBeenCalledWith(subscriptions[0], JSON.stringify({ title: "Your turn at the table", body: "BCDFGH: Your bid.", url: "/t/BCDFGH" }), expect.objectContaining({ timeout: expect.any(Number), TTL: 600 }));
  expect(mocks.bump).toHaveBeenCalledWith("push_sent");
  expect(updates).toEqual([subscriptions[0].endpoint]);
  expect(mocks.rpc).toHaveBeenCalledWith("claim_push", { p_table: "table", p_user: "human", p_event: null });
});
it.each(["live", undefined])("skips pace %s", async pace => {
  table.rules = { pace }; await notifyTurn("game"); expect(mocks.send).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
});
it("skips a visit in the last two minutes", async () => {
  visit = { last_seen: new Date(Date.now() - 119_000).toISOString() };
  await notifyTurn("game"); expect(mocks.send).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
});
it("sends after an older visit", async () => {
  visit = { last_seen: new Date(Date.now() - 121_000).toISOString() };
  await notifyTurn("game"); expect(mocks.send).toHaveBeenCalledOnce();
});
it("honors the shared atomic throttle", async () => {
  claimed = false; await notifyTurn("game"); expect(mocks.send).not.toHaveBeenCalled();
});
it.each([404, 410])("removes expired endpoints on %s", async statusCode => {
  mocks.send.mockRejectedValue({ statusCode }); await notifyTurn("game");
  expect(deletes).toEqual([subscriptions[0].endpoint]); expect(mocks.bump).toHaveBeenCalledWith("push_fail");
});
it("keeps endpoints on a temporary provider error", async () => {
  mocks.send.mockRejectedValue({ statusCode: 503 }); await notifyTurn("game"); expect(deletes).toEqual([]);
});
it.each(["hand_over", "game_over"] as const)("notifies all humans once per %s event using the shared claim", async phase => {
  state.phase = phase; state.turn = null;
  seats.push({ seat: 2, user_id: "other-human", bot: null }, { seat: 3, user_id: null, bot: "bot" });
  await notifyTurn("game");
  expect(mocks.send).toHaveBeenCalledTimes(2);
  expect(JSON.parse(mocks.send.mock.calls[0][1]).title).toBe(phase === "hand_over" ? "Hand over at BCDFGH" : "Game over at BCDFGH");
  expect(mocks.rpc).toHaveBeenCalledWith("claim_push", expect.objectContaining({ p_event: `game:${state.handNumber}:${phase}` }));
  claimed = false; await notifyTurn("game"); expect(mocks.send).toHaveBeenCalledTimes(2);
});
it("prompts only humans with unconfirmed meld when turn is null", async () => {
  state.phase = "melding"; state.turn = null; state.players[2].meldConfirmed = true;
  seats.push({ seat: 2, user_id: "ready-human", bot: null });
  await notifyTurn("game"); expect(mocks.send).toHaveBeenCalledOnce();
  expect(JSON.parse(mocks.send.mock.calls[0][1]).body).toBe("BCDFGH: Lay down your meld.");
});
it("skips bots, empty seats, unconfigured delivery, paused and superseded games", async () => {
  seats = [{ seat: 1, user_id: null, bot: "bot" }]; await notifyTurn("game");
  seats = [{ seat: 1, user_id: "human", bot: null }]; table.paused_by = "human"; await notifyTurn("game");
  table.paused_by = null; table.current_game_id = "new-game"; await notifyTurn("game");
  table.current_game_id = "game"; vi.stubEnv("VAPID_PRIVATE_KEY", ""); await notifyTurn("game");
  expect(mocks.send).not.toHaveBeenCalled();
});
it("skips users without subscriptions before claiming a throttle slot", async () => {
  subscriptions = []; await notifyTurn("game"); expect(mocks.rpc).not.toHaveBeenCalled();
});
it("bounds delivery to two seconds even when a provider hangs", async () => {
  vi.useFakeTimers(); mocks.send.mockReturnValue(new Promise(() => {}));
  const pending = notifyTurn("game"); await vi.advanceTimersByTimeAsync(2000); await pending;
  expect(mocks.bump).toHaveBeenCalledWith("push_fail");
});
it("schedules delivery after the response", () => {
  scheduleTurnNotification("game"); expect(mocks.after).toHaveBeenCalledWith(expect.any(Function));
});
