import "server-only";
import { createHash, createPrivateKey, createPublicKey, sign, type KeyObject } from "node:crypto";
import { getServerEnv } from "@/lib/env";
import type { PublicMove } from "@/engine/publicMove";
import { moveMessage } from "@/lib/moveAuth";
import { BUILD_ID } from "@/lib/staleClient";

// Ed25519 PKCS#8 header for a raw 32-byte seed.
const PKCS8_ED25519 = Buffer.from("302e020100300506032b657004220420", "hex");

let keys: { secret: string; privateKey: KeyObject; publicKey: string } | null = null;

/**
 * The server's move-signing key pair, derived from a server secret so nothing new needs configuring.
 * Only the server can sign; clients get the public key with their view and can only verify.
 */
function moveKeys() {
  const secret = getServerEnv().SUPABASE_SERVICE_ROLE_KEY;
  if (keys?.secret !== secret) {
    const seed = createHash("sha256").update(`meld-move-signing:${secret}`).digest();
    const privateKey = createPrivateKey({ key: Buffer.concat([PKCS8_ED25519, seed]), format: "der", type: "pkcs8" });
    const spki = createPublicKey(privateKey).export({ format: "der", type: "spki" });
    keys = { secret, privateKey, publicKey: spki.subarray(spki.length - 32).toString("base64url") };
  }
  return keys;
}

/** The raw public key (base64url) that checks broadcast moves. */
export const movePublicKey = () => moveKeys().publicKey;

/** The signed form of a game's public move, for the `game` broadcast. */
export function signMove(gameId: string, move: PublicMove): { move: string; sig: string } {
  const message = moveMessage(gameId, move, BUILD_ID);
  return { move: message, sig: sign(null, Buffer.from(message), moveKeys().privateKey).toString("base64url") };
}
