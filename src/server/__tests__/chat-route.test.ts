import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import { POST } from "@/app/api/tables/[code]/chat/route";
import { ApiError } from "../errors";
import { movePublicKey, signChat, signMove } from "../moveSigning";
import { openChat, CHAT_FRESH_MS } from "@/lib/chatAuth";
import { openMove } from "@/lib/moveAuth";
import type { PublicMove } from "@/engine/publicMove";

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), from: vi.fn(), enforce: vi.fn(), chat: vi.fn() }));
vi.mock("@/server/bans", () => ({ isBanned: async () => false }));
vi.mock("@/lib/supabase/server", () => ({ createClient: () => ({ auth: { getUser: mocks.getUser } }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: mocks.from }) }));
vi.mock("../tables", () => ({ tableByCode: async () => ({ id: "table", code: "BCDFGH" }) }));
vi.mock("../settings", () => ({ getSettings: async () => (await import("@/lib/settings")).DEFAULT_SETTINGS }));
vi.mock("../limits", () => ({ enforce: mocks.enforce }));
vi.mock("../realtime", () => ({ broadcastChat: mocks.chat }));
const context = { params: Promise.resolve({ code: "BCDFGH" }) };
const request = (body: unknown) => new Request("http://localhost/api/tables/BCDFGH/chat", { method: "POST", body: JSON.stringify(body) });
const line = { id: "id", from: "player", name: "Server name", text: "Hello", at: 123 };
let seated: boolean;
let dbError: { message: string } | null;

beforeEach(() => {
  vi.resetAllMocks(); seated = true; dbError = null;
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-only");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-only");
  vi.stubEnv("CRON_SECRET", "test-only");
  mocks.getUser.mockResolvedValue({ data: { user: { id: "player" } }, error: null });
  mocks.from.mockImplementation(table => {
    const query = { select: () => query, eq: vi.fn(() => query),
      maybeSingle: async () => ({ data: seated ? { seat: 0 } : null, error: dbError }),
      single: async () => ({ data: { display_name: "Server name" }, error: dbError }) };
    expect(["seats", "profiles"]).toContain(table);
    return query;
  });
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

it("stamps the seated user's identity and returns the same signed message it broadcasts", async () => {
  const start = Date.now();
  const res = await POST(request({ text: "  Hello  " }), context);
  expect(res.status).toBe(200);
  const signed = await res.json();
  const opened = await openChat(movePublicKey(), "BCDFGH", signed.message, signed.sig, Date.now());
  expect(opened).toMatchObject({ from: "player", name: "Server name", text: "Hello" });
  expect(opened!.id).toMatch(/^[a-f0-9-]{36}$/);
  expect(opened!.at).toBeGreaterThanOrEqual(start);
  expect(mocks.chat).toHaveBeenCalledWith("BCDFGH", signed);
  expect(mocks.enforce).toHaveBeenCalledWith("chat:player", 20, 60);
  expect(mocks.from.mock.results[0].value.eq.mock.calls).toEqual([["table_id", "table"], ["user_id", "player"]]);
  expect(mocks.from.mock.results[1].value.eq).toHaveBeenCalledWith("id", "player");
});
it("requires a session", async () => {
  mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
  expect((await POST(request({ text: "Hello" }), context)).status).toBe(401);
  expect(mocks.from).not.toHaveBeenCalled();
});
it("requires a seat, including for the host", async () => {
  seated = false;
  expect((await POST(request({ text: "Hello" }), context)).status).toBe(403);
  expect(mocks.chat).not.toHaveBeenCalled();
});
it.each([{}, { text: "" }, { text: "   " }, { text: "a".repeat(301) }, { text: "Hello", from: "other" },
  { text: "Hello", name: "Other" }, { text: "Hello", id: "id" }, { text: "Hello", at: 1 }])("rejects invalid bodies %j", async input => {
  expect((await POST(request(input), context)).status).toBe(400);
  expect(mocks.enforce).not.toHaveBeenCalled();
  expect(mocks.chat).not.toHaveBeenCalled();
});
it("accepts a message at the length limit", async () => {
  expect((await POST(request({ text: "a".repeat(300) }), context)).status).toBe(200);
});
it("enforces the sender's allowance before reading the table", async () => {
  mocks.enforce.mockRejectedValue(new ApiError(429, "Slow down"));
  expect((await POST(request({ text: "Hello" }), context)).status).toBe(429);
  expect(mocks.from).not.toHaveBeenCalled();
  expect(mocks.chat).not.toHaveBeenCalled();
});
it("does not broadcast after a database error", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  dbError = { message: "unavailable" };
  expect((await POST(request({ text: "Hello" }), context)).status).toBe(500);
  expect(mocks.chat).not.toHaveBeenCalled();
});
it("opens only unchanged signed talk for the same table", async () => {
  const signed = signChat("BCDFGH", line);
  expect(await openChat(movePublicKey(), "BCDFGH", signed.message, signed.sig, 123)).toEqual(line);
  expect(await openChat(movePublicKey(), "JKLMNP", signed.message, signed.sig, 123)).toBeNull();
  expect(await openChat(movePublicKey(), "BCDFGH", signed.message.replace("Server name", "Other"), signed.sig, 123)).toBeNull();
  expect(await openChat(movePublicKey(), "BCDFGH", signed.message, undefined, 123)).toBeNull();
  const { privateKey } = generateKeyPairSync("ed25519");
  const sig = sign(null, Buffer.from(signed.message), privateKey).toString("base64url");
  expect(await openChat(movePublicKey(), "BCDFGH", signed.message, sig, 123)).toBeNull();
});
it("refuses a signed message replayed long after it was sent", async () => {
  const signed = signChat("BCDFGH", line);
  expect(await openChat(movePublicKey(), "BCDFGH", signed.message, signed.sig, line.at + CHAT_FRESH_MS)).toEqual(line);
  expect(await openChat(movePublicKey(), "BCDFGH", signed.message, signed.sig, line.at + CHAT_FRESH_MS + 1)).toBeNull();
  expect(await openChat(movePublicKey(), "BCDFGH", signed.message, signed.sig, line.at - CHAT_FRESH_MS - 1)).toBeNull();
});
it("keeps chat and move signatures distinct in both directions", async () => {
  const chat = signChat("BCDFGH", line);
  const move = signMove("BCDFGH", { rev: 1 } as PublicMove);
  expect(await openMove(movePublicKey(), "BCDFGH", chat.message, chat.sig)).toBeNull();
  expect(await openChat(movePublicKey(), "BCDFGH", move.move, move.sig, 123)).toBeNull();
  expect(await openMove(movePublicKey(), "BCDFGH", move.move, move.sig)).not.toBeNull();
});

it("continues to open the previous untagged move format", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const key = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64url");
  const move = { rev: 1 };
  const message = JSON.stringify({ game: "BCDFGH", build: "previous", move });
  const sig = sign(null, Buffer.from(message), privateKey).toString("base64url");
  expect(await openMove(key, "BCDFGH", message, sig)).toEqual({ move, build: "previous" });
  expect(await openChat(key, "BCDFGH", message, sig, 123)).toBeNull();
});
