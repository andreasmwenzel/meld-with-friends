import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { broadcastTable } from "@/server/realtime";

const send = vi.fn();
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://meld.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role");
  vi.stubEnv("CRON_SECRET", "cron");
  vi.stubGlobal("fetch", send);
  send.mockReset().mockResolvedValue(new Response(null, { status: 202 }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("broadcasts the revision over REST on the normalized public table topic", async () => {
  await broadcastTable(" bcdfgh ", { type: "game", rev: 12 });
  expect(send).toHaveBeenCalledWith("https://meld.supabase.co/realtime/v1/api/broadcast", expect.objectContaining({
    method: "POST",
    headers: { apikey: "service-role", Authorization: "Bearer service-role", "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ topic: "table:BCDFGH", event: "game", payload: { type: "game", rev: 12 }, private: false }] }),
  }));
});

it.each(["network", "http"])("keeps a committed mutation successful after a %s notification failure", async failure => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  if (failure === "network") send.mockRejectedValue(new Error("offline"));
  else send.mockResolvedValue(new Response(null, { status: 503 }));
  await expect(broadcastTable("BCDFGH", { type: "seats" })).resolves.toBeUndefined();
  expect(log).toHaveBeenCalled();
});
