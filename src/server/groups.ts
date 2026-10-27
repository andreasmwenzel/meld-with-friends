import "server-only";
import { getSettings } from "./settings";
import { enforce } from "./limits";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { ApiError, checkDb } from "./errors";
import { codeSchema, groupMembersSchema, groupNameSchema, idSchema } from "./validation";

export interface GroupMember { userId: string; handle: string; displayName: string; avatarSeed: string }
export interface Group { id: string; name: string; members: GroupMember[] }
export interface Invite { code: string; hostName: string; hostSeed: string; seated: number; invitedAt: string }

interface GroupRow {
  id: string; name: string;
  members: { user_id: string; created_at: string; profile: { handle: string; display_name: string; avatar_seed: string } | null }[];
}

/** Groups need a saved account: guests have no friends to put in one. */
async function writable(user: { id: string; is_anonymous?: boolean }) {
  if (user.is_anonymous !== false) throw new ApiError(403, "Save your account to keep groups");
  await enforce(`groups:${user.id}`, (await getSettings()).limits.groupEditsPerHour, 3600);
}

const named = (error: { code?: string; message: string } | null) => {
  if (error?.code === "23505") throw new ApiError(409, "You already have a group with that name");
  checkDb(error);
};

/** The owner's groups, oldest first, members in the order they were added. Read under the owner's RLS. */
export async function getGroups(userId: string): Promise<Group[]> {
  const db = await createClient();
  const { data, error } = await db.from("friend_groups")
    .select("id,name,members:friend_group_members(user_id,created_at,profile:profiles(handle,display_name,avatar_seed))")
    .eq("owner", userId).order("created_at");
  checkDb(error);
  return ((data ?? []) as unknown as GroupRow[]).map(g => ({
    id: g.id, name: g.name,
    members: [...g.members].sort((a, b) => a.created_at.localeCompare(b.created_at)).flatMap(m => m.profile
      ? [{ userId: m.user_id, handle: m.profile.handle, displayName: m.profile.display_name, avatarSeed: m.profile.avatar_seed }] : []),
  }));
}

export async function createGroup(name: string, members: string[], user: { id: string; is_anonymous?: boolean }) {
  const clean = groupNameSchema.parse(name), ids = groupMembersSchema.parse(members);
  await writable(user);
  // One transaction: a refused member or a taken name leaves no group behind.
  const { data, error } = await createAdminClient().rpc("create_friend_group", { p_user: user.id, p_name: clean, p_members: ids });
  named(error);
  return findGroup(data as string, user.id);
}

export async function renameGroup(id: string, name: string, user: { id: string; is_anonymous?: boolean }) {
  const groupId = idSchema.parse(id), clean = groupNameSchema.parse(name);
  await writable(user);
  const { data, error } = await createAdminClient().from("friend_groups").update({ name: clean }).eq("id", groupId).eq("owner", user.id).select("id").maybeSingle();
  named(error);
  if (!data) throw new ApiError(404, "Group not found");
  return findGroup(groupId, user.id);
}

export async function setGroupMembers(id: string, members: string[], user: { id: string; is_anonymous?: boolean }) {
  const groupId = idSchema.parse(id), ids = groupMembersSchema.parse(members);
  await writable(user);
  const { error } = await createAdminClient().rpc("set_friend_group_members", { p_group: groupId, p_user: user.id, p_members: ids });
  checkDb(error);
  return findGroup(groupId, user.id);
}

export async function deleteGroup(id: string, user: { id: string; is_anonymous?: boolean }) {
  const groupId = idSchema.parse(id);
  await writable(user);
  const { data, error } = await createAdminClient().from("friend_groups").delete().eq("id", groupId).eq("owner", user.id).select("id").maybeSingle();
  checkDb(error);
  if (!data) throw new ApiError(404, "Group not found");
  return { ok: true };
}

async function findGroup(id: string, userId: string) {
  const group = (await getGroups(userId)).find(g => g.id === id);
  if (!group) throw new ApiError(404, "Group not found");
  return group;
}

export async function listInvites(userId: string): Promise<Invite[]> {
  const { data, error } = await createAdminClient().rpc("my_invites", { p_user: userId });
  checkDb(error);
  return (data ?? []) as Invite[];
}

export async function dismissInvite(code: string, userId: string) {
  const db = createAdminClient();
  const table = await db.from("tables").select("id").eq("code", codeSchema.parse(code)).maybeSingle();
  checkDb(table.error);
  if (!table.data) throw new ApiError(404, "Invitation not found");
  const { data, error } = await db.from("table_invites").delete().eq("table_id", table.data.id).eq("user_id", userId).select("table_id").maybeSingle();
  checkDb(error);
  if (!data) throw new ApiError(404, "Invitation not found");
  return { ok: true };
}
