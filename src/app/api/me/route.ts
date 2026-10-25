import { resolveRules } from "@/engine/scoring";
import { getSettings } from "@/server/settings";
import { enforce } from "@/server/limits";
import { z } from "zod";
import { body, json, requireUser } from "@/server/http";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleSchema, rulesSchema } from "@/server/validation";
import { checkDb } from "@/server/errors";

export async function GET() {
  return json(async () => {
    const { user, supabase } = await requireUser({ allowBanned: true });
    const { data, error } = await supabase.from("profiles").select("*").eq("id", user.id).single();
    checkDb(error);
    return data;
  });
}
export async function PATCH(request: Request) {
  return json(async () => {
    const { user } = await requireUser();
    const input = await body(request, z.object({ displayName: z.string().trim().min(1).max(80).optional(), handle: handleSchema.optional(), defaultRules: rulesSchema.optional() }).strict().refine(v => v.displayName !== undefined || v.handle !== undefined || v.defaultRules !== undefined, "At least one field is required"));
    await enforce(`profile:${user.id}`, (await getSettings()).limits.profileEditsPerHour, 3600);
    const patch = { ...(input.displayName !== undefined ? { display_name: input.displayName } : {}), ...(input.handle !== undefined ? { handle: input.handle } : {}), ...(input.defaultRules !== undefined ? { default_rules: resolveRules(input.defaultRules) } : {}) };
    const { data, error } = await createAdminClient().from("profiles").update(patch).eq("id", user.id).select("*").single();
    checkDb(error);
    return data;
  });
}
