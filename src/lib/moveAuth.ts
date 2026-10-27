// Anyone with the table code can send on the table channel, so the public moves broadcast there are
// signed by the server (Ed25519, see src/server/moveSigning.ts). Clients hold only the public key and
// apply a move only if the signature checks out and it names their game; anything else is treated as
// a bare revision, which fetches the view.
import type { PublicMove } from "@/engine/publicMove";

/** The exact text that is signed: the move bound to its game, so it cannot be replayed into another. */
export const moveMessage = (gameId: string, move: PublicMove) => JSON.stringify({ game: gameId, move });

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const text = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(new ArrayBuffer(text.length));
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return bytes;
}

const imported = new Map<string, Promise<CryptoKey>>();
function verifyKey(publicKey: string): Promise<CryptoKey> {
  let key = imported.get(publicKey);
  if (!key) {
    key = crypto.subtle.importKey("raw", fromBase64Url(publicKey), { name: "Ed25519" }, false, ["verify"]);
    imported.set(publicKey, key);
  }
  return key;
}

/**
 * The move, if `sig` is the server's signature of exactly `message` and it is for `gameId`; otherwise
 * null (including in browsers without Ed25519, which then simply fetch).
 */
export async function openMove(publicKey: string, gameId: string, message: unknown, sig: unknown): Promise<PublicMove | null> {
  if (typeof message !== "string" || typeof sig !== "string") return null;
  try {
    const ok = await crypto.subtle.verify({ name: "Ed25519" }, await verifyKey(publicKey), fromBase64Url(sig), new TextEncoder().encode(message));
    if (!ok) return null;
    const parsed = JSON.parse(message) as { game?: unknown; move?: PublicMove };
    return parsed.game === gameId && parsed.move ? parsed.move : null;
  } catch { return null; }
}
