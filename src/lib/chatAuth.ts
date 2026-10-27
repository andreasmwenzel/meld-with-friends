import { fromBase64Url, verifyKey } from "./moveAuth";
import { normalizeCode } from "./codes";

export interface ChatMessage { id: string; from: string; name: string; text: string; at: number }
export type SignedChat = { message: string; sig: string };
export const CHAT_MAX_LENGTH = 300;
/** A signed message is shown only this close to the server's clock, so an old one can't be sent again later. */
export const CHAT_FRESH_MS = 2 * 60_000;

/** Canonical table talk, bound to its table and distinct from public moves. */
export const chatMessage = (code: string, m: ChatMessage) => JSON.stringify({
  kind: "meld-chat:v1", code: normalizeCode(code), id: m.id, from: m.from, name: m.name, text: m.text, at: m.at,
});

export async function canVerifyChat(publicKey: string): Promise<boolean> {
  try { await verifyKey(publicKey); return true; } catch { return false; }
}

/** `now` is the server's time as this client reckons it (its clock plus the offset from the table snapshot). */
export async function openChat(publicKey: string, code: string, message: unknown, sig: unknown, now: number): Promise<ChatMessage | null> {
  if (typeof message !== "string" || typeof sig !== "string") return null;
  try {
    const ok = await crypto.subtle.verify({ name: "Ed25519" }, await verifyKey(publicKey), fromBase64Url(sig), new TextEncoder().encode(message));
    if (!ok) return null;
    const m = JSON.parse(message);
    if (m.kind !== "meld-chat:v1" || m.code !== normalizeCode(code)
      || typeof m.id !== "string" || !m.id || typeof m.from !== "string" || !m.from
      || typeof m.name !== "string" || !m.name || typeof m.text !== "string"
      || !m.text.trim() || m.text.length > CHAT_MAX_LENGTH || typeof m.at !== "number" || !Number.isFinite(m.at)
      || Math.abs(now - m.at) > CHAT_FRESH_MS) return null;
    return { id: m.id, from: m.from, name: m.name, text: m.text, at: m.at };
  } catch { return null; }
}
