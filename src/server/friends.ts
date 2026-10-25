import "server-only";
import { getSettings } from "./settings";
import { enforce } from "./limits";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { codeSchema } from "./validation";
import { ApiError, checkDb } from "./errors";

const selection = "*, requester_profile:profiles!friendships_requester_fkey(*), addressee_profile:profiles!friendships_addressee_fkey(*)";

export async function getFriends(userId: string) {
  const db = await createClient();
  const { data, error } = await db.from("friendships").select(selection).or(`requester.eq.${userId},addressee.eq.${userId}`);
  checkDb(error);
  const rows = data ?? [];
  return {
    accepted: rows.filter(row => row.status === "accepted"),
    incoming: rows.filter(row => row.status === "pending" && row.addressee === userId),
    outgoing: rows.filter(row => row.status === "pending" && row.requester === userId),
  };
}

export async function requestFriend(target: string | { userId: string }, userId: string) {
  await enforce(`friends:${userId}`, (await getSettings()).limits.friendRequestsPerHour, 3600);
  const db = createAdminClient();
  const { data: profile, error } = await db.from("profiles").select("id").eq(typeof target === "string" ? "handle" : "id", typeof target === "string" ? target : target.userId).maybeSingle();
  checkDb(error);
  if (!profile) throw new ApiError(404, "Handle not found");
  if (profile.id === userId) throw new ApiError(400, "You cannot add yourself");
  const account = await db.auth.admin.getUserById(profile.id);
  if (account.error) throw new ApiError(500, "Could not verify account");
  if (!account.data.user || account.data.user.is_anonymous) throw new ApiError(403, "Save this account before adding it as a friend");
  const result = await db.from("friendships").insert({ requester: userId, addressee: profile.id }).select(selection).single();
  checkDb(result.error);
  return result.data;
}

export async function answerFriend(id: string, accept: boolean, userId: string) {
  const db = await createClient();
  if (!accept) {
    const { data, error } = await db.from("friendships").delete().eq("id", id).eq("addressee", userId).eq("status", "pending").select("id").maybeSingle();
    checkDb(error);
    if (!data) throw new ApiError(404, "Pending request not found");
    return { ok: true };
  }
  const { data, error } = await db.from("friendships").update({ status: "accepted" }).eq("id", id).eq("addressee", userId).eq("status", "pending").select(selection).maybeSingle();
  checkDb(error);
  if (!data) throw new ApiError(404, "Pending request not found");
  return data;
}

export async function removeFriend(id: string, userId: string) {
  const db = await createClient();
  const { data, error } = await db.from("friendships").delete().eq("id", id).or(`requester.eq.${userId},addressee.eq.${userId}`).select("id").maybeSingle();
  checkDb(error);
  if (!data) throw new ApiError(404, "Friendship not found");
  return { ok: true };
}

export interface Tablemate {
  userId: string; handle: string; displayName: string;
  status: "friend" | "pending_out" | "pending_in" | "none" | "guest";
}
export async function getTablemates(code: string, userId: string): Promise<Tablemate[]> {
  const { data, error } = await createAdminClient().rpc("tablemates", { p_code: codeSchema.parse(code), p_user: userId });
  checkDb(error);
  return data ?? [];
}
