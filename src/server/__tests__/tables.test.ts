import { beforeEach, describe, expect, it, vi } from "vitest";
import { updateTableRules } from "@/server/tables";

const mocks = vi.hoisted(() => ({ from: vi.fn(), broadcast: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: mocks.from }) }));
vi.mock("@/server/realtime", () => ({ broadcastTable: mocks.broadcast }));

const table = { id: "table-id", code: "BCDFGH", host: "host", status: "open", rules: { target: 2000 } };

function query(result: unknown) {
  return {
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(), order: vi.fn().mockResolvedValue(result),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
}

beforeEach(() => vi.resetAllMocks());

describe("updating table rules", () => {
  it("replaces the partial rules and returns a refreshed snapshot after broadcasting", async () => {
    const lookup = query({ data: table, error: null });
    const update = query({ data: { id: table.id }, error: null });
    const refreshed = { ...table, rules: { counting: "classic" } };
    mocks.from.mockReturnValueOnce(lookup).mockReturnValueOnce(update)
      .mockReturnValueOnce(query({ data: refreshed, error: null }))
      .mockReturnValueOnce(query({ data: [], error: null }))
      .mockReturnValueOnce(query({ data: [], error: null }));

    const snapshot = await updateTableRules(table.code, { counting: "classic" }, "host");
    expect(update.update).toHaveBeenCalledWith({ rules: { counting: "classic" } });
    expect(update.eq.mock.calls).toEqual([["id", table.id], ["host", "host"], ["status", "open"]]);
    expect(mocks.broadcast).toHaveBeenCalledWith(table.code, { type: "seats" });
    expect(snapshot).toEqual({ table: refreshed, seats: [], offers: [], mySeat: null, ready: [], paused: null, lastSeenRev: null });
  });

  it.each([
    { host: "someone-else", status: "open", expected: 403 },
    { host: "host", status: "playing", expected: 409 },
    { host: "host", status: "finished", expected: 409 },
  ])("rejects changes for %j", async ({ host, status, expected }) => {
    mocks.from.mockReturnValueOnce(query({ data: { ...table, host, status }, error: null }));
    await expect(updateTableRules(table.code, {}, "host")).rejects.toMatchObject({ status: expected });
    expect(mocks.from).toHaveBeenCalledTimes(1);
    expect(mocks.broadcast).not.toHaveBeenCalled();
  });

  it("validates rules before writing even for direct server callers", async () => {
    mocks.from.mockReturnValueOnce(query({ data: table, error: null }));
    await expect(updateTableRules(table.code, { target: 501 }, "host")).rejects.toThrow();
    expect(mocks.from).toHaveBeenCalledTimes(1);
    expect(mocks.broadcast).not.toHaveBeenCalled();
  });

  it("rejects a table that stopped being open before the update", async () => {
    mocks.from.mockReturnValueOnce(query({ data: table, error: null }))
      .mockReturnValueOnce(query({ data: null, error: null }));
    await expect(updateTableRules(table.code, {}, "host")).rejects.toMatchObject({ status: 409 });
    expect(mocks.broadcast).not.toHaveBeenCalled();
  });
});

it("exposes ready seats and the pauser's name on the snapshot without game state", async () => {
  const pausedTable = { ...table, current_game_id: "game", paused_by: "host", paused_reason: "Dinner", paused_at: "2026-10-20T00:00:00Z" };
  mocks.from.mockImplementation((name: string) => query({ data: name === "tables" ? pausedTable : name === "games" ? { ready: [0, 2] } : name === "profiles" ? { display_name: "Ada" } : [], error: null }));
  const { getTableSnapshot } = await import("@/server/tables");
  const snapshot = await getTableSnapshot(table.code, "host");
  expect(snapshot.ready).toEqual([0, 2]);
  expect(snapshot.paused).toEqual({ by: "host", name: "Ada", reason: "Dinner", at: pausedTable.paused_at });
  expect(snapshot).not.toHaveProperty("state");
});

it.each([null, { last_rev: 17 }])("returns the caller's last seen revision %j", async visit => {
  const visitQuery = query({ data: visit, error: null });
  mocks.from.mockImplementation((name: string) => name === 'table_visits' ? visitQuery : query({
    data: name === 'tables' ? table : name === 'seats' ? [{ seat: 1, user_id: 'human', bot: null }] : [], error: null,
  }));
  const { getTableSnapshot } = await import('@/server/tables');
  const snapshot = await getTableSnapshot(table.code, 'human');
  expect(snapshot.lastSeenRev).toBe(visit?.last_rev ?? null);
  expect(visitQuery.eq.mock.calls).toEqual([['table_id', table.id], ['user_id', 'human']]);
});
