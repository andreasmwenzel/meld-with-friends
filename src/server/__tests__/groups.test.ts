import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@/lib/settings";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), userFrom: vi.fn(), enforce: vi.fn(), user: vi.fn(), createTable: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc, from: mocks.from }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: mocks.userFrom }) }));
vi.mock("@/server/settings", () => ({ getSettings: async () => DEFAULT_SETTINGS }));
vi.mock("@/server/limits", () => ({ enforce: mocks.enforce }));
vi.mock("@/server/tables", () => ({ createTable: mocks.createTable }));
vi.mock("@/server/http", async original => ({ ...await original<typeof import("@/server/http")>(), requireUser: mocks.user }));
import { createGroup, deleteGroup, dismissInvite, getGroups, renameGroup, setGroupMembers } from "../groups";
import { groupMembersSchema, groupNameSchema } from "../validation";
import { POST as postGroup } from "@/app/api/groups/route";
import { PATCH as patchGroup } from "@/app/api/groups/[id]/route";
import { POST as postTable } from "@/app/api/tables/route";

const userId = "e339e7a7-7886-4fa7-9122-31e204010f7d";
const groupId = "0b9b8f0e-3c55-4c1e-9a43-6c1a1c0e9d11";
const friendA = "64da5be1-cc7c-43d2-8dac-df4c5dca2343";
const friendB = "8f1a4d7e-2b6c-4e0f-9a1d-3c5e7b9d1f20";
const saved = { id: userId, is_anonymous: false };

/** A query builder that records every call and resolves to `result` however it is awaited. */
function chain(result: { data: unknown; error: unknown }) {
  const calls: [string, ...unknown[]][] = [];
  const builder: Record<string, unknown> = new Proxy({}, {
    get(_target, prop: string) {
      if (prop === "then") return (resolve: (v: unknown) => void) => resolve(result);
      if (prop === "single" || prop === "maybeSingle") return async () => result;
      if (prop === "calls") return calls;
      return (...args: unknown[]) => { calls.push([prop, ...args]); return builder; };
    },
  });
  return builder as Record<string, unknown> & { calls: [string, ...unknown[]][] };
}
const row = {
  id: groupId, name: "Tuesday",
  members: [
    { user_id: friendB, created_at: "2026-10-02", profile: { handle: "bea", display_name: "Bea", avatar_seed: "b" } },
    { user_id: friendA, created_at: "2026-10-01", profile: { handle: "al", display_name: "Al", avatar_seed: "a" } },
  ],
};
const json = (method: string, body: unknown) => new Request("http://localhost/api", { method, body: JSON.stringify(body) });
const idContext = { params: Promise.resolve({ id: groupId }) };

let reads: ReturnType<typeof chain>;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.mockResolvedValue({ user: saved });
  reads = chain({ data: [row], error: null });
  mocks.userFrom.mockReturnValue(reads);
  mocks.rpc.mockResolvedValue({ data: null, error: null });
});

describe("validation", () => {
  it("trims names and bounds them at 1 to 40 characters", () => {
    expect(groupNameSchema.parse("  Tuesday four ")).toBe("Tuesday four");
    for (const bad of ["", "   ", "x".repeat(41)]) expect(groupNameSchema.safeParse(bad).success).toBe(false);
  });
  it("takes up to 12 distinct member ids", () => {
    const ids = Array.from({ length: 13 }, () => crypto.randomUUID());
    expect(groupMembersSchema.safeParse(ids.slice(0, 12)).success).toBe(true);
    expect(groupMembersSchema.safeParse(ids).success).toBe(false);
    expect(groupMembersSchema.safeParse([friendA, friendA]).success).toBe(false);
    expect(groupMembersSchema.safeParse(["not-a-uuid"]).success).toBe(false);
  });
});

describe("group operations", () => {
  it("reads the owner's groups under their session, members in the order they joined", async () => {
    expect(await getGroups(userId)).toEqual([{
      id: groupId, name: "Tuesday",
      members: [
        { userId: friendA, handle: "al", displayName: "Al", avatarSeed: "a" },
        { userId: friendB, handle: "bea", displayName: "Bea", avatarSeed: "b" },
      ],
    }]);
    expect(mocks.userFrom).toHaveBeenCalledWith("friend_groups");
    expect(reads.calls).toContainEqual(["eq", "owner", userId]);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("creates a group with its members under the group quota", async () => {
    const insert = chain({ data: { id: groupId }, error: null });
    mocks.from.mockReturnValue(insert);
    const group = await createGroup(" Tuesday ", [friendA, friendB], saved);
    expect(group.name).toBe("Tuesday");
    expect(insert.calls[0]).toEqual(["insert", { owner: userId, name: "Tuesday" }]);
    expect(mocks.enforce).toHaveBeenCalledWith(`groups:${userId}`, 60, 3600);
    expect(mocks.rpc).toHaveBeenCalledWith("set_friend_group_members", { p_group: groupId, p_user: userId, p_members: [friendA, friendB] });
  });

  it("removes a new group again when a member is refused", async () => {
    const insert = chain({ data: { id: groupId }, error: null });
    mocks.from.mockReturnValue(insert);
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "23514", message: "Only friends can be in a group" } });
    await expect(createGroup("Tuesday", [friendA], saved)).rejects.toMatchObject({ status: 400, message: "Only friends can be in a group" });
    expect(insert.calls.map(c => c[0])).toContain("delete");
  });

  it("validates before spending quota and keeps guests out", async () => {
    await expect(createGroup("", [], saved)).rejects.toThrow();
    await expect(setGroupMembers(groupId, Array(13).fill(friendA), saved)).rejects.toThrow();
    expect(mocks.enforce).not.toHaveBeenCalled();
    await expect(createGroup("Tuesday", [], { id: userId, is_anonymous: true })).rejects.toMatchObject({ status: 403 });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("names a duplicate as a conflict and a missing group as not found", async () => {
    mocks.from.mockReturnValue(chain({ data: null, error: { code: "23505", message: "duplicate key value" } }));
    await expect(createGroup("Tuesday", [], saved)).rejects.toMatchObject({ status: 409, message: "You already have a group with that name" });
    mocks.from.mockReturnValue(chain({ data: null, error: null }));
    await expect(renameGroup(groupId, "Friday", saved)).rejects.toMatchObject({ status: 404 });
    await expect(deleteGroup(groupId, saved)).rejects.toMatchObject({ status: 404 });
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "P0002", message: "Group not found" } });
    await expect(setGroupMembers(groupId, [friendA], saved)).rejects.toMatchObject({ status: 404 });
  });

  it("only dismisses the player's own invitation", async () => {
    const table = chain({ data: { id: "t1" }, error: null });
    const invite = chain({ data: null, error: null });
    mocks.from.mockImplementation(name => name === "tables" ? table : invite);
    await expect(dismissInvite("bcdfgh", userId)).rejects.toMatchObject({ status: 404 });
    expect(table.calls).toContainEqual(["eq", "code", "BCDFGH"]);
    expect(invite.calls).toContainEqual(["eq", "user_id", userId]);
  });
});

describe("routes", () => {
  it("creates with 201 and rejects unknown fields", async () => {
    mocks.from.mockReturnValue(chain({ data: { id: groupId }, error: null }));
    expect((await postGroup(json("POST", { name: "Tuesday" }))).status).toBe(201);
    expect((await postGroup(json("POST", { name: "Tuesday", owner: friendA }))).status).toBe(400);
  });
  it("patches either the name or the members, not both", async () => {
    mocks.from.mockReturnValue(chain({ data: { id: groupId }, error: null }));
    expect((await patchGroup(json("PATCH", { name: "Friday" }), idContext)).status).toBe(200);
    expect((await patchGroup(json("PATCH", { members: [friendA] }), idContext)).status).toBe(200);
    expect((await patchGroup(json("PATCH", { name: "Friday", members: [] }), idContext)).status).toBe(400);
    expect((await patchGroup(json("PATCH", { name: "x" }), { params: Promise.resolve({ id: "nope" }) })).status).toBe(400);
  });
  it("deals for a group: checks the group first, then invites its members", async () => {
    mocks.from.mockReturnValue(chain({ data: { id: groupId }, error: null }));
    mocks.createTable.mockResolvedValue({ id: "t1", code: "BCDFGH" });
    mocks.rpc.mockResolvedValue({ data: 3, error: null });
    const res = await postTable(json("POST", { rules: {}, groupId }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "t1", code: "BCDFGH", invited: 3 });
    expect(mocks.rpc).toHaveBeenCalledWith("invite_group", { p_table: "t1", p_group: groupId, p_user: userId });
  });
  it("does not deal for someone else's group, and still returns the table if inviting fails", async () => {
    mocks.from.mockReturnValue(chain({ data: null, error: null }));
    expect((await postTable(json("POST", { groupId }))).status).toBe(404);
    expect(mocks.createTable).not.toHaveBeenCalled();
    mocks.from.mockReturnValue(chain({ data: { id: groupId }, error: null }));
    mocks.createTable.mockResolvedValue({ id: "t1", code: "BCDFGH" });
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "boom" } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await postTable(json("POST", { groupId }));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ code: "BCDFGH", invited: null });
  });
  it("deals without a group exactly as before", async () => {
    mocks.createTable.mockResolvedValue({ id: "t1", code: "BCDFGH" });
    expect(await (await postTable(json("POST", {}))).json()).toEqual({ id: "t1", code: "BCDFGH" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe("migration 0018", () => {
  const sql = readFileSync("supabase/migrations/0018_friend_groups.sql", "utf8");
  it("keeps groups owner-only and writes behind the API", () => {
    for (const t of ["friend_groups", "friend_group_members", "table_invites"]) expect(sql).toContain(`alter table public.${t} enable row level security;`);
    expect(sql).toContain("using (owner=auth.uid())");
    expect(sql).toMatch(/revoke all on public\.friend_groups,public\.friend_group_members,public\.table_invites from public,anon,authenticated;/);
    expect(sql).toMatch(/grant select on public\.friend_groups,public\.friend_group_members to authenticated;/);
    expect(sql).not.toMatch(/grant (insert|update|delete|all)[^;]*to authenticated/);
  });
  it("enforces the caps and the friends-only rule in SQL", () => {
    expect(sql).toContain("where owner=new.owner)>20");
    expect(sql).toContain("where group_id=new.group_id)>12");
    expect(sql).toContain("length(name) between 1 and 40");
    expect(sql).toContain("'Only friends can be in a group'");
    expect(sql).toContain("after update or delete on public.friendships");
  });
  it("exposes its functions to the service role only", () => {
    for (const fn of ["set_friend_group_members(uuid,uuid,uuid[])", "invite_group(uuid,uuid,uuid)", "my_invites(uuid)"]) {
      expect(sql).toContain(`public.${fn}`);
    }
    expect(sql).toMatch(/grant execute on function public\.set_friend_group_members\(uuid,uuid,uuid\[\]\),public\.invite_group\(uuid,uuid,uuid\),public\.my_invites\(uuid\) to service_role;/);
  });
});
