import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyAction, newGame, viewFor } from "@/engine/game";
import { randomAction } from "@/engine/ai/arena";
import { random } from "@/engine/ai/shared";
import type { Action, GameState, SeatIndex } from "@/engine/types";

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), enforce: vi.fn(), session: vi.fn(), settings: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: mocks.from, rpc: mocks.rpc }) }));
vi.mock("@/server/limits", () => ({ enforce: mocks.enforce }));
vi.mock("@/server/settings", () => ({ getSettings: mocks.settings }));
vi.mock("@/lib/auth", () => ({ getSessionUser: mocks.session }));
import { getReplay } from "../replay";
import { GET } from "@/app/api/replay/[id]/route";
import { ApiError } from "../errors";

const GAME = "e339e7a7-7886-4fa7-9122-31e204010f7d";
const SEED = "server-replay-seed";

function playUntil(done: (state: GameState) => boolean, rules = {}) {
  const rng = random("rng");
  let state = newGame(SEED, rules, 1);
  const actions: Action[] = [];
  while (!done(state)) {
    const seat = (state.phase === "melding" ? state.players.find(p => !p.meldConfirmed)!.seat : state.turn ?? 0) as SeatIndex;
    const action = randomAction(viewFor(state, seat), rng);
    state = applyAction(state, action); actions.push(action);
  }
  return { state, actions };
}

/** A query builder that resolves to the rows for its table whatever the chain of filters. */
function chain(rows: unknown) {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order"]) q[m] = vi.fn(() => q);
  q.maybeSingle = vi.fn(async () => ({ data: Array.isArray(rows) ? rows[0] ?? null : rows, error: null }));
  q.then = (resolve: (v: unknown) => void) => resolve({ data: rows, error: null });
  return q;
}
function database(tables: Record<string, unknown>) {
  mocks.from.mockImplementation((name: string) => chain(name in tables ? tables[name] : null));
}
const gameRow = (state: GameState) => ({ id: GAME, table_id: "table", state, rev: state.rev, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-02T00:00:00Z" });
const log = (actions: Action[]) => actions.map((action, i) => ({ action, rev: i + 1 }));
const snapshot = [
  { seat: 0, user_id: "alice", name: "Alice", bot: false }, { seat: 1, user_id: null, name: "Mabel", bot: true },
  { seat: 2, user_id: "bob", name: "Bob", bot: false }, { seat: 3, user_id: "carol", name: "Carol", bot: false },
];

beforeEach(() => { vi.resetAllMocks(); mocks.settings.mockResolvedValue({ limits: { replaysPerHour: 120 } }); });

describe("getReplay", () => {
  it("replays a finished game with the result snapshot's names and the reader's seat", async () => {
    const { state, actions } = playUntil(s => s.phase === "game_over");
    database({ games: gameRow(state), game_actions: log(actions), game_results: { code: "BCDFGH", seats: snapshot, finished_at: "2026-10-02T00:00:00Z" } });
    const replay = await getReplay(GAME, "bob");
    expect(replay).toMatchObject({ gameId: GAME, code: "BCDFGH", finished: true, hands: state.history.length, viewerSeat: 2, finishedAt: "2026-10-02T00:00:00Z" });
    expect(replay.seats.map(s => s.name)).toEqual(["Alice", "Mabel", "Bob", "Carol"]);
    expect(replay.steps.length).toBe(actions.length);
    expect(JSON.stringify(replay)).not.toContain(SEED);
    expect(JSON.stringify(replay)).not.toContain("alice");
    expect((await getReplay(GAME, null)).viewerSeat).toBeNull();
    expect((await getReplay(GAME, "stranger")).viewerSeat).toBeNull();
  });
  it("uses live seats for a game in progress and leaves the current hand out", async () => {
    const { state, actions } = playUntil(s => s.history.length === 1 && s.phase === "playing");
    database({
      games: gameRow(state), game_actions: log(actions), game_results: null, tables: { code: "JKMNPQ" },
      seats: [
        { seat: 0, user_id: "alice", bot: null, profile: { display_name: "Alice" } }, { seat: 1, user_id: null, bot: "Otto", profile: null },
        { seat: 2, user_id: "bob", bot: null, profile: { display_name: "Bob" } }, { seat: 3, user_id: null, bot: null, profile: null },
      ],
    });
    const replay = await getReplay(GAME, "alice");
    expect(replay).toMatchObject({ code: "JKMNPQ", finished: false, hands: 1, viewerSeat: 0, finishedAt: null });
    expect(replay.seats).toEqual([
      { seat: 0, name: "Alice", bot: false }, { seat: 1, name: "Otto", bot: true }, { seat: 2, name: "Bob", bot: false }, { seat: 3, name: "Empty seat", bot: false },
    ]);
    expect(replay.steps.length).toBeLessThan(actions.length);
    expect(replay.steps.some(step => step.state?.handNumber === 2)).toBe(false);
    // Until the game is over, the link works only for the people at the table.
    await expect(getReplay(GAME, null)).rejects.toMatchObject({ status: 403 });
    await expect(getReplay(GAME, "stranger")).rejects.toMatchObject({ status: 403 });
  });
  it("rejects bad ids, missing games, private tables, broken logs and games without a finished hand", async () => {
    await expect(getReplay("not-a-uuid", null)).rejects.toMatchObject({ status: 404 });
    expect(mocks.from).not.toHaveBeenCalled();
    database({ games: null, game_actions: [], game_results: null });
    await expect(getReplay(GAME, null)).rejects.toMatchObject({ status: 404 });

    const hidden = playUntil(s => s.history.length === 1, { revealHands: false });
    database({ games: gameRow(hidden.state), game_actions: log(hidden.actions), game_results: null });
    await expect(getReplay(GAME, null)).rejects.toMatchObject({ status: 409 });

    const early = playUntil(s => s.phase === "playing");
    database({ games: gameRow(early.state), game_actions: log(early.actions), game_results: null });
    await expect(getReplay(GAME, null)).rejects.toMatchObject({ status: 404, message: expect.stringContaining("No hand has finished") });

    const done = playUntil(s => s.history.length === 2);
    database({ games: gameRow(done.state), game_actions: log(done.actions.slice(1)), game_results: null });
    await expect(getReplay(GAME, null)).rejects.toMatchObject({ status: 422 });
  });
  it("still replays a table whose hands are private once the game is over", async () => {
    const { state, actions } = playUntil(s => s.phase === "game_over", { revealHands: false });
    database({ games: gameRow(state), game_actions: log(actions), game_results: { code: "BCDFGH", seats: snapshot, finished_at: "x" } });
    expect((await getReplay(GAME, null)).finished).toBe(true);
  });
});

describe("GET /api/replay/[id]", () => {
  const context = { params: Promise.resolve({ id: GAME }) };
  it("serves anonymous readers, keyed by the forwarded address", async () => {
    const { state, actions } = playUntil(s => s.phase === "game_over");
    database({ games: gameRow(state), game_actions: log(actions), game_results: { code: "BCDFGH", seats: snapshot, finished_at: "x" } });
    mocks.session.mockResolvedValue(null);
    const response = await GET(new Request("http://localhost/api/replay", { headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" } }), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.enforce).toHaveBeenCalledWith("replay:203.0.113.9", 120, 3600);
    expect((await response.json()).viewerSeat).toBeNull();
  });
  it("faces the board toward a signed-in player and reports the limit", async () => {
    const { state, actions } = playUntil(s => s.phase === "game_over");
    database({ games: gameRow(state), game_actions: log(actions), game_results: { code: "BCDFGH", seats: snapshot, finished_at: "x" } });
    mocks.session.mockResolvedValue({ id: "carol" });
    expect((await (await GET(new Request("http://localhost/api/replay"), context)).json()).viewerSeat).toBe(3);
    expect(mocks.enforce).toHaveBeenCalledWith("replay:local", 120, 3600);
    mocks.enforce.mockRejectedValue(new ApiError(429, "Slow down"));
    expect((await GET(new Request("http://localhost/api/replay"), context)).status).toBe(429);
  });
});
