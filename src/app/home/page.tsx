import Link from "next/link";
import { GitHubLink } from "@/components/site/GitHubLink";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Wordmark } from "@/components/site/Wordmark";
import { Friends } from "@/components/lobby/Friends";
import { KeepAccount } from "@/components/site/KeepAccount";
import { HouseRules } from "@/components/lobby/HouseRules";
import type { RulesPatch } from "@/components/rules/rules";
import { History } from "@/components/lobby/History";
import { DealTable } from "@/components/lobby/DealTable";
import { ProfileEditor } from "@/components/lobby/ProfileEditor";
import { SignOut } from "@/components/site/SignOut";
import { getSessionUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { listMyTables } from "@/server/myTables";
import { listInvites } from "@/server/groups";
import { Invitations } from "@/components/lobby/Invitations";
import { TableList } from "@/components/lobby/TableList";

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
        <Lobby searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Lobby({ searchParams }: { searchParams: PageProps<"/home">["searchParams"] }) {
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

  return (
    <div className="mx-auto grid max-w-6xl gap-14 px-6 pb-16 pt-4 sm:pb-20 sm:pt-6 lg:grid-cols-[1.2fr_1fr]">
      <section>
        <h1 className="display" style={{ fontSize: "clamp(40px, 6vw, 72px)" }}>
          Evening, {profile?.display_name?.split(" ")[0] ?? "friend"}.
        </h1>
        {profile && <div className="mt-3"><ProfileEditor me={profile} /></div>}
        <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
          <DealTable autoOpen={sp.new === "1"} defaults={(profile?.default_rules as RulesPatch | null) ?? null} saved={!user.is_anonymous} />
          <Link href="/practice" className="tap text-sm text-chalk-faint underline-offset-4 hover:text-chalk hover:underline">Practice hand</Link>
        </div>
        <Invitations invites={invites} />
        <HouseRules initial={(profile?.default_rules as RulesPatch | null) ?? null} />
        <h2 className="display mt-12" style={{ fontSize: 34 }}>Your tables</h2>
        {tables.length === 0 ? (
          <p className="mt-3 max-w-md text-chalk-faint">
            You are not sitting anywhere yet. Deal a table above, or join one with the code a friend sent you.
          </p>
        ) : (
          <div className="mt-2"><TableList tables={tables} /></div>
        )}
        <History />
      </section>
      {profile && (user.is_anonymous ? (
        <section>
          <KeepAccount />
          <p className="mt-4 max-w-md text-sm text-chalk-faint">Friends lists and the people-online view unlock once your account is saved.</p>
        </section>
      ) : (
        <Friends me={profile} />
      ))}
    </div>
  );
}
