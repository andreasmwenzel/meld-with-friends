import { fromBase64Url, verifyKey } from "./moveAuth";
import { normalizeCode } from "./codes";

export interface ChatMessage { id: string; from: string; name: string; text: string; at: number }
export type SignedChat = { message: string; sig: string };
export const CHAT_MAX_LENGTH = 300;

/** Canonical table talk, bound to its table and distinct from public moves. */
export const chatMessage = (code: string, m: ChatMessage) => JSON.stringify({
  kind: "meld-chat:v1", code: normalizeCode(code), id: m.id, from: m.from, name: m.name, text: m.text, at: m.at,
});

export async function canVerifyChat(publicKey: string): Promise<boolean> {
  try { await verifyKey(publicKey); return true; } catch { return false; }
}

export async function openChat(publicKey: string, code: string, message: unknown, sig: unknown): Promise<ChatMessage | null> {
  if (typeof message !== "string" || typeof sig !== "string") return null;
  try {
    const ok = await crypto.subtle.verify({ name: "Ed25519" }, await verifyKey(publicKey), fromBase64Url(sig), new TextEncoder().encode(message));
    if (!ok) return null;
    const m = JSON.parse(message);
    if (m.kind !== "meld-chat:v1" || m.code !== normalizeCode(code)
      || typeof m.id !== "string" || !m.id || typeof m.from !== "string" || !m.from
      || typeof m.name !== "string" || !m.name || typeof m.text !== "string"
      || !m.text.trim() || m.text.length > CHAT_MAX_LENGTH || typeof m.at !== "number" || !Number.isFinite(m.at)) return null;
    return { id: m.id, from: m.from, name: m.name, text: m.text, at: m.at };
  } catch { return null; }
}
