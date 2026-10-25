import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ from: vi.fn(), getUser: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: mocks.from }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: () => ({ auth: { getUser: mocks.getUser } }) }));
import { ban, isBanned, unban } from "../bans";
import { requireUser } from "../http";
let banned: boolean;
let query: { select: ReturnType<typeof vi.fn>; eq: ReturnType<typeof vi.fn>; maybeSingle: ReturnType<typeof vi.fn>; upsert: ReturnType<typeof vi.fn>; single: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn>; then: (resolve: (v: unknown) => void) => void };
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2035-01-01"));
  banned = true;
  query = {
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(async () => ({ data: banned ? { user_id: "suspended" } : null, error: null })),
    upsert: vi.fn().mockReturnThis(), single: vi.fn(async () => ({ data: { user_id: "suspended" }, error: null })),
    delete: vi.fn().mockReturnThis(), then: resolve => resolve({ error: null }),
  };
  mocks.from.mockReturnValue(query);
  mocks.getUser.mockResolvedValue({ data: { user: { id: "suspended" } }, error: null });
});
afterEach(() => { vi.useRealTimers(); });
it("caches both outcomes for 30 seconds", async () => {
  expect(await isBanned("cache-user")).toBe(true);
  banned = false;
  expect(await isBanned("cache-user")).toBe(true);
  expect(query.maybeSingle).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(30_001);
  expect(await isBanned("cache-user")).toBe(false);
  expect(await isBanned("cache-user")).toBe(false);
  expect(query.maybeSingle).toHaveBeenCalledTimes(2);
});
it("blocks suspended accounts but permits the explicit me exception", async () => {
  await expect(requireUser()).rejects.toMatchObject({ status: 403, message: "This account is suspended." });
  await expect(requireUser({ allowBanned: true })).resolves.toMatchObject({ user: { id: "suspended" } });
});
it("authenticates before checking bans", async () => {
  mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
  await expect(requireUser()).rejects.toMatchObject({ status: 401 });
  expect(mocks.from).not.toHaveBeenCalled();
});
it("invalidates local cache on unban", async () => {
  expect(await isBanned("unban-user")).toBe(true);
  await unban("unban-user"); banned = false;
  expect(await isBanned("unban-user")).toBe(false);
});
it("resolves normalized handles and invalidates local cache on ban", async () => {
  banned = false;
  expect(await isBanned("new-ban")).toBe(false);
  query.maybeSingle.mockResolvedValueOnce({ data: { id: "new-ban" }, error: null });
  await ban("PLAYER", "Abuse"); banned = true;
  expect(query.eq).toHaveBeenCalledWith("handle", "player");
  expect(query.upsert).toHaveBeenCalledWith({ user_id: "new-ban", reason: "Abuse" }, { onConflict: "user_id" });
  expect(await isBanned("new-ban")).toBe(true);
});
it("fails closed when the ban lookup fails", async () => {
  query.maybeSingle.mockResolvedValue({ data: null, error: { code: "42501", message: "Denied" } });
  await expect(isBanned("lookup-error")).rejects.toMatchObject({ status: 403 });
});
