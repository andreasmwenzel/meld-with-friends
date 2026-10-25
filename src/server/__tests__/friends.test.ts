import { beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@/lib/settings";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), account: vi.fn(), enforce: vi.fn(), user: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc, from: mocks.from, auth: { admin: { getUserById: mocks.account } } }) }));
vi.mock("@/server/settings", () => ({ getSettings: async () => DEFAULT_SETTINGS }));
vi.mock("@/server/limits", () => ({ enforce: mocks.enforce }));
vi.mock("@/server/http", async original => ({ ...await original<typeof import("@/server/http")>(), requireUser: mocks.user }));
import { getTablemates, requestFriend } from "../friends";
import { POST } from "@/app/api/friends/route";
import { GET } from "@/app/api/tables/[code]/tablemates/route";
const userId = "e339e7a7-7886-4fa7-9122-31e204010f7d";
const targetId = "64da5be1-cc7c-43d2-8dac-df4c5dca2343";
const context = { params: Promise.resolve({ code: "BCDFGH" }) };
const request = (body: unknown) => new Request("http://localhost/api/friends", { method: "POST", body: JSON.stringify(body) });
let eq: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.mockResolvedValue({ user: { id: userId } });
  mocks.account.mockResolvedValue({ data: { user: { is_anonymous: false } }, error: null });
  eq = vi.fn().mockReturnValue({ maybeSingle: async () => ({ data: { id: targetId }, error: null }) });
  mocks.from.mockImplementation(table => table === "profiles"
    ? { select: () => ({ eq }) }
    : { insert: (row: unknown) => ({ select: () => ({ single: async () => ({ data: row, error: null }) }) }) });
});
it("resolves handles and IDs to the same friendship using the same quota", async () => {
  for (const target of ["player", { userId: targetId }]) {
    expect(await requestFriend(target, userId)).toEqual({ requester: userId, addressee: targetId });
    expect(mocks.enforce).toHaveBeenLastCalledWith(`friends:${userId}`, 20, 3600);
  }
  expect(eq.mock.calls).toEqual([["handle", "player"], ["id", targetId]]);
});
it("rejects guest targets and self requests", async () => {
  mocks.account.mockResolvedValue({ data: { user: { is_anonymous: true } }, error: null });
  await expect(requestFriend({ userId: targetId }, userId)).rejects.toMatchObject({ status: 403 });
  await expect(requestFriend("player", targetId)).rejects.toMatchObject({ status: 400 });
  expect(mocks.from).not.toHaveBeenCalledWith("friendships");
});
it("accepts exactly one validated handle or UUID and returns 201", async () => {
  for (const input of [{ handle: "PLAYER" }, { userId: targetId }]) expect((await POST(request(input))).status).toBe(201);
  expect(eq).toHaveBeenCalledWith("handle", "player");
  for (const input of [{}, { userId: "bad" }, { handle: "player", userId: targetId }, { userId: targetId, extra: true }]) expect((await POST(request(input))).status).toBe(400);
  expect(mocks.enforce).toHaveBeenCalledTimes(2);
});
it("returns the tablemate projection as a bare array and propagates the seated-human gate", async () => {
  const rows = ["friend", "pending_out", "pending_in", "none", "guest"].map(status => ({ userId: targetId, handle: "player", displayName: "Player", status }));
  mocks.rpc.mockResolvedValue({ data: rows, error: null });
  expect(await (await GET(new Request("http://localhost"), context)).json()).toEqual(rows);
  expect(mocks.rpc).toHaveBeenCalledWith("tablemates", { p_code: "BCDFGH", p_user: userId });
  mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "You must be seated to view tablemates" } });
  expect((await GET(new Request("http://localhost"), context)).status).toBe(403);
  await expect(getTablemates("invalid", userId)).rejects.toThrow();
});
