import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { signChat, movePublicKey } from "../moveSigning";
import { openChat } from "@/lib/chatAuth";
import { broadcastTable, broadcastChat, notifyInvited } from "@/server/realtime";

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

it("nudges each invited player's lobby in one request, with nothing in the payload", async () => {
  await notifyInvited(["u1", "u2"]);
  expect(send).toHaveBeenCalledTimes(1);
  expect(JSON.parse(send.mock.calls[0][1].body)).toEqual({ messages: [
    { topic: "invites:u1", event: "invites", payload: { type: "invites" }, private: false },
    { topic: "invites:u2", event: "invites", payload: { type: "invites" }, private: false },
  ] });
  await notifyInvited([]);
  expect(send).toHaveBeenCalledTimes(1);
});

it("sends signed bot chat on the normalized transient topic", async () => {
  const message = { id: "bot:game:hand:3", from: "bot:table:1", name: "Otto", text: "Nice set, Margaret.", at: 123 };
  const signed = signChat("BCDFGH", message);
  await broadcastChat(" bcdfgh ", signed);
  expect(await openChat(movePublicKey(), "BCDFGH", signed.message, signed.sig, 123)).toEqual(message);
  expect(JSON.parse(send.mock.calls[0][1].body)).toEqual({ messages: [
    { topic: "chat:BCDFGH", event: "chat", payload: signed, private: false },
  ] });
});
