import Link from "next/link";
import { GitHubLink } from "@/components/site/GitHubLink";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Wordmark } from "@/components/site/Wordmark";
import type { RulesPatch } from "@/components/rules/rules";
import { SignOut } from "@/components/site/SignOut";
import { getSessionUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { listMyTables } from "@/server/myTables";
import { listInvites } from "@/server/groups";
import { Lobby } from "@/components/lobby/Lobby";

export default function HomePage({ searchParams }: PageProps<"/home">) {
  return (
    <main className="flex-1">
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-6 py-5 sm:py-6">
        <Wordmark size={30} />
        <nav className="flex items-center gap-2">
          <Link href="/join" className="btn btn-ghost btn-compact">Join with a code</Link>
          <SignOut />
          <GitHubLink />
        </nav>
      </header>
      <Suspense fallback={<div className="mx-auto max-w-6xl px-6 py-10 text-chalk-faint">Setting the table.</div>}>
        <LoadLobby searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function LoadLobby({ searchParams }: { searchParams: PageProps<"/home">["searchParams"] }) {
  const user = await getSessionUser();
  if (!user) redirect("/?next=/home");
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data: profile }, tables, invites] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).single(),
    listMyTables(user.id),
    // Only friends are invited, and guests have none. Invitations never keep the lobby from loading.
    user.is_anonymous ? [] : listInvites(user.id).catch((error: unknown) => { console.error("my_invites", error); return []; }),
  ]);

  const defaults = (profile?.default_rules as RulesPatch | null) ?? null;
  return <Lobby userId={user.id} profile={profile} guest={!!user.is_anonymous} tables={tables} invites={invites} autoDeal={sp.new === "1"} defaults={defaults} />;
}
