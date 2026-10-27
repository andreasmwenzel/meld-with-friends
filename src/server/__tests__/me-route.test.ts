import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveRules } from "@/engine/scoring";
import { GET, PATCH } from "@/app/api/me/route";

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), from: vi.fn(), update: vi.fn(), eq: vi.fn(), select: vi.fn(), single: vi.fn(), admin: vi.fn(), isBanned: vi.fn() }));
vi.mock("@/server/bans", () => ({ isBanned: mocks.isBanned }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({ auth: { getUser: mocks.getUser }, from: mocks.from }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));

const request = (input: unknown) => new Request("http://localhost/api/me", {
  method: "PATCH", body: JSON.stringify(input), headers: { "Content-Type": "application/json" },
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.isBanned.mockResolvedValue(false);
  mocks.getUser.mockResolvedValue({ data: { user: { id: "verified-user" } }, error: null });
  const query = { update: mocks.update, eq: mocks.eq, select: mocks.select, single: mocks.single };
  mocks.admin.mockReturnValue({ from: mocks.from });
  mocks.from.mockReturnValue(query);
  mocks.update.mockReturnValue(query);
  mocks.eq.mockReturnValue(query);
  mocks.select.mockReturnValue(query);
  mocks.single.mockResolvedValue({ data: { id: "verified-user", default_rules: { revealHands: false } }, error: null });
});

describe("profile rules API contract", () => {
  it.each([{ revealHands: false }, {}, { passCount: 0, counting: "classic", shoot: "on" }])(
    "resolves partial defaults before saving %j for the authenticated user", async defaultRules => {
      const response = await PATCH(request({ defaultRules }));
      expect(response.status).toBe(200);
      expect(mocks.update).toHaveBeenCalledWith({ default_rules: resolveRules(defaultRules) });
      expect(mocks.from).toHaveBeenCalledWith("profiles");
      expect(mocks.eq).toHaveBeenCalledWith("id", "verified-user");
      expect(await response.json()).toEqual({ id: "verified-user", default_rules: { revealHands: false } });
    },
  );

  it("accepts profile fields together with defaults", async () => {
    const response = await PATCH(request({ displayName: " Player ", handle: "PLAYER", defaultRules: {} }));
    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({ display_name: "Player", handle: "player", default_rules: resolveRules({}) });
  });

  it.each([{}, { defaultRules: null }, { defaultRules: { extra: true } }, { defaultRules: { revealHands: "false" } },
    { defaultRules: { target: 501 } }, { defaultRules: {}, id: "someone-else" }])(
    "rejects invalid profile updates %j", async input => {
      expect((await PATCH(request(input))).status).toBe(400);
      expect(mocks.admin).not.toHaveBeenCalled();
      expect(mocks.update).not.toHaveBeenCalled();
    },
  );

  it("requires authentication before writing defaults", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect((await PATCH(request({ defaultRules: {} }))).status).toBe(401);
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it("includes stored default_rules in GET", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: "verified-user", default_rules: { revealHands: false } });
    expect(mocks.select).toHaveBeenCalledWith("*");
    expect(mocks.eq).toHaveBeenCalledWith("id", "verified-user");
  });
});

vi.mock('@/server/settings', () => ({ getSettings: async () => (await import('@/lib/settings')).DEFAULT_SETTINGS }));
vi.mock('@/server/limits', () => ({ enforce: async () => {} }));


it("keeps GET working for banned accounts while blocking profile writes", async () => {
  mocks.isBanned.mockResolvedValue(true);
  expect((await GET()).status).toBe(200);
  expect(mocks.isBanned).not.toHaveBeenCalled();
  const response = await PATCH(request({ displayName: "Blocked" }));
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: "This account is suspended." });
  expect(mocks.admin).not.toHaveBeenCalled();
});
