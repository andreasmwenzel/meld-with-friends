import { beforeEach, expect, it, vi } from "vitest";
import { POST } from "@/app/api/me/handle/route";

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), rpc: vi.fn(), from: vi.fn(), eq: vi.fn(), select: vi.fn(), single: vi.fn(), isBanned: vi.fn(), getSettings: vi.fn() }));
vi.mock("@/server/bans", () => ({ isBanned: mocks.isBanned }));
vi.mock("@/server/settings", () => ({ getSettings: mocks.getSettings }));
vi.mock("@/lib/supabase/server", () => ({ createClient: () => ({ auth: { getUser: mocks.getUser } }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc, from: mocks.from }) }));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.isBanned.mockResolvedValue(false);
  mocks.getSettings.mockResolvedValue({ limits: { profileEditsPerHour: 5 } });
  mocks.getUser.mockResolvedValue({ data: { user: { id: "verified-user" } }, error: null });
  const query = { eq: mocks.eq, select: mocks.select, single: mocks.single };
  mocks.from.mockReturnValue(query);
  mocks.select.mockReturnValue(query);
  mocks.eq.mockReturnValue(query);
  mocks.single.mockResolvedValue({ data: { id: "verified-user", handle: "copper_heron" }, error: null });
  mocks.rpc.mockImplementation(async (name: string) => ({ data: name === "consume_rate" ? true : "copper_heron", error: null }));
});

it("draws a new handle for the signed-in player only and returns the profile", async () => {
  const response = await POST();
  expect(response.status).toBe(200);
  expect(mocks.rpc).toHaveBeenCalledWith("consume_rate", { p_key: "profile:verified-user", p_limit: 5, p_window_seconds: 3600 });
  expect(mocks.rpc).toHaveBeenCalledWith("regenerate_handle", { p_user: "verified-user" });
  expect(mocks.eq).toHaveBeenCalledWith("id", "verified-user");
  expect(await response.json()).toEqual({ id: "verified-user", handle: "copper_heron" });
});

it("stops at the profile edit limit before drawing", async () => {
  mocks.rpc.mockResolvedValue({ data: false, error: null });
  const response = await POST();
  expect(response.status).toBe(429);
  expect(mocks.rpc).not.toHaveBeenCalledWith("regenerate_handle", expect.anything());
});

it("requires a session", async () => {
  mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
  expect((await POST()).status).toBe(401);
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it("reports a failed draw instead of returning a stale profile", async () => {
  mocks.rpc.mockImplementation(async (name: string) => name === "consume_rate" ? { data: true, error: null } : { data: null, error: { code: "P0001", message: "Could not find a free handle" } });
  const response = await POST();
  expect(response.status).toBeGreaterThanOrEqual(400);
  expect(mocks.from).not.toHaveBeenCalled();
});
