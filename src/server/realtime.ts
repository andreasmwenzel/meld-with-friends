import "server-only";
import { bump } from "./metrics";
import { getServerEnv } from "@/lib/env";
import { normalizeCode } from "@/lib/codes";

/** A game event may carry the public move as signed JSON (see src/lib/moveAuth.ts). */
export type GameEvent = { type: "game"; rev: number; move?: string; sig?: string };
export type TableEvent = { type: "seats" | "trade" } | GameEvent;

export async function broadcastTable(code: string, payload: TableEvent) {
  try {
    const env = getServerEnv();
    const result = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "")}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messages: [{ topic: `table:${normalizeCode(code)}`, event: payload.type, payload, private: false }] }),
      signal: AbortSignal.timeout(5000),
    });
    if (!result.ok) { bump("broadcast_fail"); console.error("Table broadcast failed", { code, status: result.status }); }
  } catch (error) {
    bump("broadcast_fail");
    // A notification failure must not make a committed mutation look unsuccessful.
    console.error("Table broadcast failed", error);
  }
}
