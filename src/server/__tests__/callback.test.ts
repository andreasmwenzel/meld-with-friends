import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/auth/callback/route";

const exchange = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { exchangeCodeForSession: exchange } }),
}));

beforeEach(() => { exchange.mockReset().mockResolvedValue({ error: null }); });

describe("auth callback", () => {
  it.each(["/t/BCDFGH", "/home?new=1"])("exchanges the PKCE code and keeps %s", async next => {
    const response = await GET(new Request(`https://meld.example/auth/callback?code=pkce-code&next=${encodeURIComponent(next)}`));
    expect(exchange).toHaveBeenCalledWith("pkce-code");
    expect(response.headers.get("location")).toBe(`https://meld.example${next}`);
  });

  it.each(["//evil.example", "/\\evil.example", "/\t/evil.example", "https://evil.example", "//["])("rejects unsafe next %j", async next => {
    const response = await GET(new Request(`https://meld.example/auth/callback?code=pkce-code&next=${encodeURIComponent(next)}`));
    expect(response.headers.get("location")).toBe("https://meld.example/home");
  });

  it("does not redirect a failed code exchange", async () => {
    exchange.mockResolvedValue({ error: new Error("expired") });
    const response = await GET(new Request("https://meld.example/auth/callback?code=expired"));
    expect(response.status).toBe(400);
    expect(response.headers.has("location")).toBe(false);
  });
});
