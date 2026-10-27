"use client";

import { useLayoutEffect } from "react";
import { notFound } from "next/navigation";
import { DealTable } from "@/components/lobby/DealTable";
import { Groups } from "@/components/lobby/Groups";
import { Invitations } from "@/components/lobby/Invitations";
import type { Group, Profile } from "@/lib/api";

const FRIENDS: Profile[] = ["Margaret Hale", "June", "Theo Brandt", "Lee", "Sam Okafor", "Rosa"].map((name, i) => ({
  id: `f${i}`, handle: name.split(" ")[0].toLowerCase(), display_name: name, avatar_seed: `${i}`,
}));
const member = (p: Profile) => ({ userId: p.id, handle: p.handle, displayName: p.display_name, avatarSeed: p.avatar_seed });
let groups: Group[] = [
  { id: "g1", name: "Tuesday night", members: [FRIENDS[0], FRIENDS[1], FRIENDS[2]].map(member) },
  { id: "g2", name: "Cousins", members: [FRIENDS[3], FRIENDS[4], FRIENDS[5], FRIENDS[1]].map(member) },
];

/**
 * The groups API, in memory, so the editor and the deal picker work without a session. Installed for
 * as long as the preview is mounted: a layout effect runs before the children's data effects, and
 * its cleanup hands `fetch` back before the next page loads anything.
 */
function usePreviewGroupsApi() {
  useLayoutEffect(() => {
    const real = window.fetch;
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!url.startsWith("/api/groups")) return real(input, init);
      const body = init?.body ? JSON.parse(init.body as string) : {};
      const id = url.split("/")[3];
      const members = (ids: string[]) => FRIENDS.filter((f) => ids.includes(f.id)).map(member);
      if (init?.method === "POST") groups = [...groups, { id: `g${Date.now()}`, name: body.name, members: members(body.members ?? []) }];
      if (init?.method === "PATCH") groups = groups.map((g) => g.id !== id ? g : "name" in body ? { ...g, name: body.name } : { ...g, members: members(body.members) });
      if (init?.method === "DELETE") groups = groups.filter((g) => g.id !== id);
      return Response.json(id ? groups.find((g) => g.id === id) ?? { ok: true } : groups);
    };
    return () => { window.fetch = real; };
  }, []);
}

/** Local-only preview of groups: an invitation, the deal panel's group picker, and the groups list and editor. */
export default function DevGroupsPage() {
  usePreviewGroupsApi();
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <main className="mx-auto max-w-6xl px-6 pb-16 pt-6">
      <Invitations invites={[{ code: "KQJ9TA", hostName: "Margaret Hale", hostSeed: "0", seated: 2, invitedAt: "2026-10-26T19:00:00Z" }]} />
      <div className="mt-6"><DealTable autoOpen saved /></div>
      <Groups friends={FRIENDS} />
    </main>
  );
}
