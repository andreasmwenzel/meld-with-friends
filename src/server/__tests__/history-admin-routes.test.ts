import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), history: vi.fn(), tables: vi.fn(), finish: vi.fn(), ban: vi.fn(), unban: vi.fn(), bans: vi.fn() }));
vi.mock("@/server/http", async original => ({ ...await original<typeof import("@/server/http")>(), requireUser: mocks.user }));
vi.mock("@/server/history", () => ({ listHistory: mocks.history }));
vi.mock("@/server/adminTables", () => ({ listTables: mocks.tables, forceFinish: mocks.finish }));
vi.mock("@/server/bans", () => ({ ban: mocks.ban, unban: mocks.unban, listBans: mocks.bans }));
import { GET as history } from "@/app/api/history/route";
import { GET as tables } from "@/app/api/admin/tables/route";
import { POST as finish } from "@/app/api/admin/tables/[code]/finish/route";
import { GET as bans, POST as ban, DELETE as unban } from "@/app/api/admin/bans/route";
import { ApiError } from "../errors";
const request = (value?: unknown) => new Request("http://localhost/api", { method: "POST", body: JSON.stringify(value ?? {}) });
const context = { params: Promise.resolve({ code: "BCDFGH" }) };
const uuid = "e339e7a7-7886-4fa7-9122-31e204010f7d";
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("ADMIN_EMAILS", "admin@example.com");
  mocks.user.mockResolvedValue({ user: { id: uuid, email: "admin@example.com", is_anonymous: false } });
});
afterEach(() => vi.unstubAllEnvs());
it("returns history as a bare array for saved users and guests", async () => {
  const entries = [{ gameId: "game", code: "BCDFGH", finishedAt: "now", score: { red: 1500, blue: 1000 }, myTeam: "red", won: true, abandoned: false, hands: 3, partner: "Partner", opponents: ["A", "B"] }];
  mocks.history.mockResolvedValue(entries);
  expect(await (await history()).json()).toEqual(entries);
  expect(mocks.history).toHaveBeenCalledWith(uuid);
  mocks.user.mockResolvedValue({ user: { id: "guest", is_anonymous: true } });
  mocks.history.mockResolvedValue([]);
  expect(await (await history()).json()).toEqual([]);
});
it("requires auth for history and every new admin handler", async () => {
  mocks.user.mockRejectedValue(new ApiError(401, "Authentication required"));
  for (const response of [await history(), await tables(request()), await finish(request(), context), await bans(), await ban(request()), await unban(request())]) expect(response.status).toBe(401);
  expect(mocks.history).not.toHaveBeenCalled(); expect(mocks.tables).not.toHaveBeenCalled();
});
it("requires saved admin access for all inspector and ban methods", async () => {
  for (const user of [{ email: "other@example.com" }, { email: "admin@example.com", is_anonymous: true }]) {
    mocks.user.mockResolvedValue({ user });
    for (const response of [await tables(request()), await finish(request(), context), await bans(), await ban(request()), await unban(request())]) expect(response.status).toBe(403);
  }
  for (const fn of [mocks.tables, mocks.finish, mocks.ban, mocks.unban, mocks.bans]) expect(fn).not.toHaveBeenCalled();
});
it("validates inspector filters and returns the array directly", async () => {
  const rows = [{ code: "BCDFGH", status: "playing", hostHandle: "host", seats: [{ seat: 0, name: "Mabel", bot: true }], createdAt: "created", lastActivity: "updated", rev: 3, phase: "bidding" }];
  mocks.tables.mockResolvedValue(rows);
  const response = await tables(new Request("http://localhost/api/admin/tables?status=playing&limit=20"));
  expect(await response.json()).toEqual(rows);
  expect(mocks.tables).toHaveBeenCalledWith({ status: "playing", limit: 20 });
  await tables(request());
  expect(mocks.tables).toHaveBeenLastCalledWith({ limit: 50 });
  for (const query of ["status=wrong", "limit=0", "limit=201", "limit=abc"]) expect((await tables(new Request(`http://localhost/api?${query}`))).status).toBe(400);
});
it("finishes by code and validates ban/unban requests", async () => {
  mocks.finish.mockResolvedValue({ code: "BCDFGH", status: "finished" });
  expect(await (await finish(request(), context)).json()).toEqual({ code: "BCDFGH", status: "finished" });
  expect(mocks.finish).toHaveBeenCalledWith("BCDFGH");
  mocks.ban.mockResolvedValue({ user_id: uuid, reason: "Abuse", created_at: "now" });
  expect((await ban(request({ handle: "PLAYER", reason: "Abuse" }))).status).toBe(200);
  expect(mocks.ban).toHaveBeenCalledWith("player", "Abuse");
  await ban(request({ userId: uuid })); expect(mocks.ban).toHaveBeenLastCalledWith(uuid, undefined);
  mocks.unban.mockResolvedValue({ ok: true });
  expect(await (await unban(request({ userId: uuid }))).json()).toEqual({ ok: true });
  for (const input of [{}, { userId: "bad" }, { handle: "player", userId: uuid }, { handle: "player", extra: true }]) expect((await ban(request(input))).status).toBe(400);
  expect((await unban(request({ userId: "bad" }))).status).toBe(400);
});
