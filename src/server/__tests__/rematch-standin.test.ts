vi.mock("@/server/bans", () => ({ isBanned: async () => false }));
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveRules } from "@/engine/scoring";
import { newGame } from "@/engine";
import { rematch, standIn, leaveSeat } from "@/server/tables";
import { POST as rematchRoute } from "@/app/api/tables/[code]/rematch/route";
import { POST as standinRoute } from "@/app/api/tables/[code]/standin/route";
import { DELETE as leaveRoute } from "@/app/api/tables/[code]/seat/route";

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), broadcast: vi.fn(), getUser: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: mocks.from, rpc: mocks.rpc }) }));
vi.mock("@/server/bans", () => ({ isBanned: async () => false }));
vi.mock("@/server/realtime", () => ({ broadcastTable: mocks.broadcast }));
vi.mock("@/lib/supabase/server", () => ({ createClient: () => ({ auth: { getUser: mocks.getUser } }) }));

const context = { params: Promise.resolve({ code: "BCDFGH" }) };
const request = (body?: unknown) => new Request("http://localhost/api", { method: "POST", ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const table = { id: "table", code: "BCDFGH", host: "host", current_game_id: "old-game", status: "finished", rules: { target: 300 } };
let current: Omit<typeof table, "current_game_id"> & { current_game_id: string | null };
let previous: ReturnType<typeof newGame>;
let filters: [string, unknown][];
beforeEach(() => {
  vi.resetAllMocks();
  current = { ...table };
  previous = newGame("old", {}, 3);
  previous.phase = "game_over";
  filters = [];
  mocks.from.mockImplementation((name: string) => {
    const result = { data: name === "tables" ? current : name === "games" ? { id: "old-game", state: previous } : [], error: null };
    const chain = { select: () => chain, eq: (key: string, value: unknown) => { if (name === "games") filters.push([key, value]); return chain; }, maybeSingle: async () => result, order: async () => result };
    return chain;
  });
  mocks.rpc.mockResolvedValue({ data: null, error: null });
  mocks.getUser.mockResolvedValue({ data: { user: { id: "host", is_anonymous: false } }, error: null });
});

describe("rematch", () => {
  it("creates a fresh game using current rules and the next dealer, then broadcasts both events", async () => {
    expect(await rematch(table.code, "host")).toEqual({ code: table.code, rev: 0 });
    expect(filters).toEqual([["id", "old-game"]]);
    expect(mocks.rpc).toHaveBeenCalledWith("rematch_game", {
      p_table: "table", p_user: "host", p_previous: "old-game", p_rules: resolveRules({ target: 300 }),
      p_state: expect.objectContaining({ dealer: 0, rev: 0, handNumber: 1, score: { red: 0, blue: 0 }, rules: expect.objectContaining({ target: 300 }) }),
    });
    expect(mocks.broadcast.mock.calls).toEqual([[table.code, { type: "seats" }], [table.code, { type: "game", rev: 0 }]]);
  });
  it.each([0, 1, 2, 3] as const)("rotates final dealer %i by one seat", async dealer => {
    previous.dealer = dealer;
    await rematch(table.code, "host");
    expect(mocks.rpc).toHaveBeenCalledWith("rematch_game", expect.objectContaining({ p_state: expect.objectContaining({ dealer: (dealer + 1) % 4 }) }));
  });
  it("rejects a finished table without a previous game", async () => {
    current.current_game_id = null;
    await expect(rematch(table.code, "host")).rejects.toMatchObject({ status: 409 });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("also permits a game_over game while the table still says playing", async () => {
    current.status = "playing";
    await expect(rematch(table.code, "host")).resolves.toMatchObject({ rev: 0 });
  });
  it("permits a finished table whose last game was abandoned", async () => {
    previous.phase = "bidding";
    await expect(rematch(table.code, "host")).resolves.toMatchObject({ rev: 0 });
  });
  it("rejects an unfinished game", async () => {
    current.status = "playing"; previous.phase = "bidding";
    await expect(rematch(table.code, "host")).rejects.toMatchObject({ status: 409 });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("returns 403 for a non-host", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "other" } }, error: null });
    expect((await rematchRoute(request(), context)).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["40001", "PT409"])("does not broadcast when a competing rematch wins (%s)", async code => {
    mocks.rpc.mockResolvedValue({ error: { code, message: "Table changed" } });
    expect((await rematchRoute(request(), context)).status).toBe(409);
    expect(mocks.broadcast).not.toHaveBeenCalled();
  });
});

describe("stand-ins and leaving", () => {
  beforeEach(() => { current.status = "playing"; });
  it("replaces the requested human through the transaction and returns a refreshed snapshot", async () => {
    const snapshot = await standIn(table.code, 2, "host");
    expect(mocks.rpc).toHaveBeenCalledWith("stand_in", { p_table: "table", p_user: "host", p_seat: 2 });
    expect(snapshot.table.status).toBe("playing");
    expect(mocks.broadcast).toHaveBeenCalledWith(table.code, { type: "seats" });
  });
  it("returns the finished table when the transaction replaces the last human", async () => {
    mocks.rpc.mockImplementation(async () => { current.status = "finished"; return { error: null }; });
    expect((await standIn(table.code, 0, "host")).table.status).toBe("finished");
  });
  it("requires a host and a playing table", async () => {
    await expect(standIn(table.code, 2, "other")).rejects.toMatchObject({ status: 403 });
    current.status = "open";
    await expect(standIn(table.code, 2, "host")).rejects.toMatchObject({ status: 409 });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([{}, { seat: -1 }, { seat: 4 }, { seat: "1" }, { seat: 1, extra: true }])("rejects invalid bodies %j", async input => {
    expect((await standinRoute(request(input), context)).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("forbids guest stand-ins but allows a guest to leave", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "guest", is_anonymous: true } }, error: null });
    expect((await standinRoute(request({ seat: 1 }), context)).status).toBe(403);
    expect(mocks.from).not.toHaveBeenCalled();
    expect((await leaveRoute(request(), context)).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("leave_seat", { p_table: "table", p_user: "guest" });
  });
  it("uses the same leave RPC and broadcasts the seat change", async () => {
    await leaveSeat(table.code, "human");
    expect(mocks.rpc).toHaveBeenCalledWith("leave_seat", { p_table: "table", p_user: "human" });
    expect(mocks.broadcast).toHaveBeenCalledWith(table.code, { type: "seats" });
  });
  it.each([rematchRoute, standinRoute])("requires authentication", async handler => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect((await handler(request({ seat: 1 }), context)).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
