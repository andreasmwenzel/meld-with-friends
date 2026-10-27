import { randomUUID } from "node:crypto";
import { z } from "zod";
import { body, json, requireUser, type CodeContext } from "@/server/http";
import { createAdminClient } from "@/lib/supabase/admin";
import { CHAT_MAX_LENGTH } from "@/lib/chatAuth";
import { tableByCode } from "@/server/tables";
import { ApiError, checkDb } from "@/server/errors";
import { enforce } from "@/server/limits";
import { getSettings } from "@/server/settings";
import { signChat } from "@/server/moveSigning";
import { broadcastChat } from "@/server/realtime";

export async function POST(request: Request, context: CodeContext) {
  return json(async () => {
    const { user } = await requireUser();
    const { text } = await body(request, z.object({ text: z.string().trim().min(1).max(CHAT_MAX_LENGTH) }).strict());
    const { limits } = await getSettings();
    await enforce(`chat:${user.id}`, limits.chatMessagesPerMinute, 60);
    const table = await tableByCode((await context.params).code);
    const admin = createAdminClient();
    const seat = await admin.from("seats").select("seat").eq("table_id", table.id).eq("user_id", user.id).maybeSingle();
    checkDb(seat.error);
    if (!seat.data) throw new ApiError(403, "Take a seat to send table talk.");
    const profile = await admin.from("profiles").select("display_name").eq("id", user.id).single();
    checkDb(profile.error);
    if (!profile.data) throw new ApiError(404, "Profile not found");
    const signed = signChat(table.code, { id: randomUUID(), from: user.id, name: profile.data.display_name, text, at: Date.now() });
    await broadcastChat(table.code, signed);
    return signed;
  });
}
