import "server-only";
import { bump } from "./metrics";
import { getServerEnv } from "@/lib/env";
import { normalizeCode } from "@/lib/codes";

export type TableEvent = { type: "seats" | "trade" } | { type: "game"; rev: number };

interface Message { topic: string; event: string; payload: Record<string, unknown> }

async function broadcast(messages: Message[], label: string, context: Record<string, unknown> = {}) {
  if (!messages.length) return;
  try {
    const env = getServerEnv();
    const result = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "")}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messages: messages.map(m => ({ ...m, private: false })) }),
      signal: AbortSignal.timeout(5000),
    });
    if (!result.ok) { bump("broadcast_fail"); console.error(`${label} broadcast failed`, { ...context, status: result.status }); }
  } catch (error) {
    bump("broadcast_fail");
    // A notification failure must not make a committed mutation look unsuccessful.
    console.error(`${label} broadcast failed`, error);
  }
}

export async function broadcastTable(code: string, payload: TableEvent) {
  await broadcast([{ topic: `table:${normalizeCode(code)}`, event: payload.type, payload }], "Table", { code });
}

/**
 * Nudges each invited player's lobby to refetch its invitations. The payload carries nothing: the
 * lobby reads the invitations themselves through the API, under the player's own session.
 */
export async function notifyInvited(userIds: string[]) {
  await broadcast(userIds.map(id => ({ topic: `invites:${id}`, event: "invites", payload: { type: "invites" } })), "Invitation", { count: userIds.length });
}
