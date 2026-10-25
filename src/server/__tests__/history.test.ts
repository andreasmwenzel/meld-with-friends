import { beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => mocks }));
import { listHistory, recordGameResult } from "../history";
beforeEach(() => vi.resetAllMocks());

it("retries the same idempotent snapshot RPC without replacing existing results", async () => {
  const results = new Map<string, object>();
  let snapshot = { score: { red: 1510, blue: 900 }, name: "Original partner" };
  mocks.rpc.mockImplementation(async (name, { p_game }) => {
    expect(name).toBe("record_game_result");
    if (!results.has(p_game)) results.set(p_game, structuredClone(snapshot));
    return { error: null };
  });
  await recordGameResult("game");
  snapshot = { score: { red: 0, blue: 0 }, name: "Rematch partner" };
  await recordGameResult("game");
  expect(results.size).toBe(1);
  expect(results.get("game")).toEqual({ score: { red: 1510, blue: 900 }, name: "Original partner" });
  expect(mocks.rpc).toHaveBeenCalledTimes(2);
  // The real RPC must retain the same insert-only behavior as the mock.
  const sql = readFileSync("supabase/migrations/0008_history_admin_bans.sql", "utf8");
  expect(sql).toContain("on conflict(game_id) do nothing returning game_id into inserted");
  expect(sql).toContain("if inserted is null then return; end if");
});
it("propagates database failures so callers can report them", async () => {
  mocks.rpc.mockResolvedValue({ error: { code: "42501", message: "Denied" } });
  await expect(recordGameResult("game")).rejects.toMatchObject({ status: 403 });
});
it("limits history to the user and maps saved seats rather than current profiles", async () => {
  const query = {
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: [{
      game_id: "game", code: "BCDFGH", finished_at: "2026-10-20T00:00:00Z", score: { red: 1510, blue: 900 }, hands: 5,
      seats: [{ seat: 0, user_id: "me", name: "Me", bot: false }, { seat: 1, name: "Mabel", bot: true },
        { seat: 2, name: "Partner", bot: false }, { seat: 3, name: "Opponent", bot: false }],
      game_result_players: [{ team: "red", won: true }],
    }], error: null }),
  };
  mocks.from.mockReturnValue(query);
  expect(await listHistory("me")).toEqual([{
    gameId: "game", code: "BCDFGH", finishedAt: "2026-10-20T00:00:00Z", score: { red: 1510, blue: 900 },
    hands: 5, myTeam: "red", won: true, partner: "Partner", opponents: ["Mabel", "Opponent"],
  }]);
  expect(query.eq).toHaveBeenCalledWith("game_result_players.user_id", "me");
  expect(query.limit).toHaveBeenCalledWith(50);
});
