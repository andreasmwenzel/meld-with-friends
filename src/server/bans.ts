import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { ApiError, checkDb } from "./errors";
import { handleSchema } from "./validation";

const cached = new Map<string, { banned: boolean; expires: number }>();
export async function isBanned(userId: string): Promise<boolean> {
  const entry = cached.get(userId);
  if (entry && entry.expires > Date.now()) return entry.banned;
  const { data, error } = await createAdminClient().from("banned_users").select("user_id").eq("user_id", userId).maybeSingle();
  checkDb(error);
  // Bound process memory even when many different accounts make requests.
  if (cached.size >= 1000) cached.clear();
  cached.set(userId, { banned: !!data, expires: Date.now() + 30_000 });
  return !!data;
}

export async function ban(handleOrUserId: string, reason?: string) {
  const admin = createAdminClient();
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(handleOrUserId);
  const { data: profile, error: profileError } = await admin.from("profiles").select("id")
    .eq(uuid ? "id" : "handle", uuid ? handleOrUserId : handleSchema.parse(handleOrUserId)).maybeSingle();
  checkDb(profileError);
  if (!profile) throw new ApiError(404, "User not found");
  const { data, error } = await admin.from("banned_users").upsert({ user_id: profile.id, reason: reason ?? null }, { onConflict: "user_id" }).select("*").single();
  checkDb(error);
  cached.delete(profile.id);
  return data;
}
export async function unban(userId: string) {
  const { error } = await createAdminClient().from("banned_users").delete().eq("user_id", userId);
  checkDb(error);
  cached.delete(userId);
  return { ok: true };
}
export async function listBans() {
  const { data, error } = await createAdminClient().from("banned_users").select("user_id,reason,created_at").order("created_at", { ascending: false });
  checkDb(error);
  return data ?? [];
}
