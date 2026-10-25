import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ from: vi.fn(), broadcast: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: mocks.from }) }));
vi.mock("@/server/realtime", () => ({ broadcastTable: mocks.broadcast }));
import { forceFinish, listTables } from "../adminTables";
beforeEach(() => vi.resetAllMocks());
it("uses the active game and exposes only inspector metadata", async () => {
  const query = {
    select: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
    then: (resolve: (v: unknown) => void) => resolve({ data: [{
      code: "BCDFGH", status: "playing", created_at: "created", hostProfile: { handle: "host" },
      seats: [{ seat: 2, bot: "Mabel", profile: null }, { seat: 0, bot: null, profile: { display_name: "Player" } }],
      game: { updated_at: "updated", rev: 5, phase: "playing" },
    }, { code: "JKLMNP", status: "open", created_at: "created", hostProfile: null, seats: [{ seat: 0, bot: null, profile: null }], game: null }], error: null }),
  };
  mocks.from.mockReturnValue(query);
  expect(await listTables({ status: "playing" })).toEqual([{
    code: "BCDFGH", status: "playing", hostHandle: "host", createdAt: "created", lastActivity: "updated", rev: 5, phase: "playing",
    seats: [{ seat: 0, name: "Player", bot: false }, { seat: 2, name: "Mabel", bot: true }],
  }, {
    code: "JKLMNP", status: "open", hostHandle: null, createdAt: "created", lastActivity: "created", rev: null, phase: null,
    seats: [{ seat: 0, name: null, bot: false }],
  }]);
  expect(query.eq).toHaveBeenCalledWith("status", "playing");
  expect(query.limit).toHaveBeenCalledWith(50);
  expect(query.select.mock.calls[0][0]).toContain("games!tables_current_game_id_fkey");
});
it("sets finished and broadcasts only after a successful update", async () => {
  const query = { update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: { code: "BCDFGH" }, error: null }) };
  mocks.from.mockReturnValue(query);
  expect(await forceFinish("bcdfgh")).toEqual({ code: "BCDFGH", status: "finished" });
  expect(query.update).toHaveBeenCalledWith({ status: "finished" });
  expect(query.eq).toHaveBeenCalledWith("code", "BCDFGH");
  expect(mocks.broadcast).toHaveBeenCalledWith("BCDFGH", { type: "seats" });
  mocks.broadcast.mockClear();
  query.maybeSingle.mockResolvedValue({ data: null, error: null });
  await expect(forceFinish("BCDFGH")).rejects.toMatchObject({ status: 404 });
  expect(mocks.broadcast).not.toHaveBeenCalled();
});
