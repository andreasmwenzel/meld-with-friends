import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ from: vi.fn(), user: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: mocks.from }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: () => ({ auth: { getUser: mocks.user } }) }));
vi.mock("@/server/bans", () => ({ isBanned: async () => false }));
import { POST, DELETE } from "@/app/api/push/subscribe/route";
import { GET } from "@/app/api/push/key/route";
const subscription = { endpoint: "https://fcm.googleapis.com/push/sub", expirationTime: null, keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) } };
const request = (method: string, value: unknown) => new Request("https://meld.test/api/push/subscribe", { method, body: JSON.stringify(value) });
let upsert: ReturnType<typeof vi.fn>;
let eq: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.mockResolvedValue({ data: { user: { id: "human" } }, error: null });
  upsert = vi.fn().mockResolvedValue({ error: null });
  const q = { eq: vi.fn(), then: (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve) };
  q.eq.mockReturnValue(q); eq = q.eq;
  mocks.from.mockReturnValue({ upsert, delete: () => q });
});
it("upserts a browser subscription for the authenticated user only", async () => {
  const response = await POST(request("POST", { subscription }));
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ ok: true });
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(mocks.from).toHaveBeenCalledWith("push_subscriptions");
  expect(upsert).toHaveBeenCalledWith({ user_id: "human", endpoint: subscription.endpoint, keys: subscription.keys }, { onConflict: "endpoint" });
});
it("scopes deletion to the authenticated owner", async () => {
  const response = await DELETE(request("DELETE", { endpoint: subscription.endpoint }));
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ ok: true });
  expect(eq.mock.calls).toEqual([["endpoint", subscription.endpoint], ["user_id", "human"]]);
});
it.each([POST, DELETE])("requires authentication", async route => {
  mocks.user.mockResolvedValue({ data: { user: null }, error: null });
  expect((await route(request("POST", { subscription }))).status).toBe(401);
  expect(mocks.from).not.toHaveBeenCalled();
});
it.each([{}, { subscription: {} }, { subscription, userId: "other" }, { subscription: { ...subscription, keys: { auth: "bad" } } }, { subscription: { ...subscription, endpoint: "https://127.0.0.1/internal" } }, { subscription: { ...subscription, endpoint: "http://fcm.googleapis.com/sub" } }])("rejects invalid POST %j", async value => {
  expect((await POST(request("POST", value))).status).toBe(400); expect(mocks.from).not.toHaveBeenCalled();
});
it("rejects malformed JSON and invalid delete requests", async () => {
  expect((await POST(new Request("https://meld.test", { method: "POST", body: "{" }))).status).toBe(400);
  expect((await DELETE(request("DELETE", { endpoint: subscription.endpoint, userId: "other" }))).status).toBe(400);
});
it("exposes only the public key and handles unconfigured servers", async () => {
  try {
    vi.stubEnv("VAPID_PUBLIC_KEY", "public"); vi.stubEnv("VAPID_PRIVATE_KEY", "private");
    expect(await (await GET()).json()).toEqual({ publicKey: "public" });
    vi.stubEnv("VAPID_PUBLIC_KEY", ""); expect(await (await GET()).json()).toEqual({ publicKey: null });
  } finally { vi.unstubAllEnvs(); }
});
