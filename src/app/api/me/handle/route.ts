import { getSettings } from "@/server/settings";
import { enforce } from "@/server/limits";
import { json, requireUser } from "@/server/http";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkDb } from "@/server/errors";

/** Draws a fresh two-word handle for the player. Counts against the same hourly limit as profile edits. */
export async function POST() {
  return json(async () => {
    const { user } = await requireUser();
    await enforce(`profile:${user.id}`, (await getSettings()).limits.profileEditsPerHour, 3600);
    const admin = createAdminClient();
    const drawn = await admin.rpc("regenerate_handle", { p_user: user.id });
    checkDb(drawn.error);
    const { data, error } = await admin.from("profiles").select("*").eq("id", user.id).single();
    checkDb(error);
    return data;
  });
}
