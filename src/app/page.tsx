import { Suspense } from "react";
import { FrontDoor, Welcome } from "@/components/site/FrontDoor";
import { Lobby, LobbyFrame } from "@/components/lobby/Lobby";
import { LiveRefresh } from "@/components/lobby/LiveRefresh";
import { getSessionUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { listMyTables } from "@/server/myTables";
import { listInvites } from "@/server/groups";
import type { TableSummary } from "@/lib/tableStatus";
import type { RulesPatch } from "@/components/rules/rules";

/**
 * New players get the front door, one screen tall on a phone, with a name field and a code box.
 * Anyone with a session, guests included, gets the lobby: their tables first, then dealing a new one.
 */
export default function Landing({ searchParams }: PageProps<"/">) {
  return (
    <Suspense fallback={<main className="flex-1" />}>
      <Front searchParams={searchParams} />
    </Suspense>
  );
}

async function Front({ searchParams }: { searchParams: PageProps<"/">["searchParams"] }) {
  const user = await getSessionUser();
  if (!user) return <FrontDoor><Welcome /></FrontDoor>;
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data: profile }, tables, invites] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).single(),
    listMyTables(user.id).catch((error: unknown) => { console.error("listMyTables", error); return [] as TableSummary[]; }),
    // Only friends are invited, and guests have none. Invitations never keep the lobby from loading.
    user.is_anonymous ? [] : listInvites(user.id).catch((error: unknown) => { console.error("my_invites", error); return []; }),
  ]);
  return (
    <LobbyFrame>
      <Lobby userId={user.id} profile={profile} guest={!!user.is_anonymous} tables={tables} invites={invites}
        autoDeal={sp.new === "1"} defaults={(profile?.default_rules as RulesPatch | null) ?? null} />
      <LiveRefresh />
    </LobbyFrame>
  );
}
