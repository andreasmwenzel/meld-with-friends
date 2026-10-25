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
  const [{ data: profile }, { data: seats }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).single(),
    supabase.from("seats").select("seat, table:tables(id, code, status, game_kind, created_at)").eq("user_id", user.id),
  ]);
  type SeatRow = { seat: number; table: { id: string; code: string; status: string; game_kind: string; created_at: string } | null };
  const tables = ((seats ?? []) as unknown as SeatRow[])
    .map((s) => s.table)
    .filter((t): t is NonNullable<SeatRow["table"]> => !!t && t.status !== "finished")
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  return (
    <div className="mx-auto grid max-w-6xl gap-14 px-6 pb-16 pt-4 sm:pb-20 sm:pt-6 lg:grid-cols-[1.2fr_1fr]">
      <section>
        <h1 className="display" style={{ fontSize: "clamp(40px, 6vw, 72px)" }}>
          Evening, {profile?.display_name?.split(" ")[0] ?? "friend"}.
        </h1>
        {profile && <div className="mt-3"><ProfileEditor me={profile} /></div>}
        <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
          <DealTable autoOpen={sp.new === "1"} defaults={(profile?.default_rules as RulesPatch | null) ?? null} />
          <Link href="/practice" className="tap text-sm text-chalk-faint underline-offset-4 hover:text-chalk hover:underline">Practice hand</Link>
        </div>
        <HouseRules initial={(profile?.default_rules as RulesPatch | null) ?? null} />
        <h2 className="display mt-12" style={{ fontSize: 34 }}>Your tables</h2>
        {tables.length === 0 ? (
          <p className="mt-3 max-w-md text-chalk-faint">
            You are not sitting anywhere yet. Deal a table above, or join one with the code a friend sent you.
          </p>
        ) : (
          <ul className="mt-4 flex flex-col divide-y divide-chalk-ghost">
            {tables.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-4">
                <div>
                  <p className="code" style={{ fontSize: 28, letterSpacing: ".14em" }}>{t.code}</p>
                  <p className="text-sm text-chalk-faint">{t.status === "playing" ? "Hand in progress" : "Waiting for players"}</p>
                </div>
                <Link href={`/t/${t.code}`} className={`btn ${t.status === "playing" ? "btn-brass" : "btn-chalk"}`}>
                  {t.status === "playing" ? "Back to the game" : "Go to the table"}
                </Link>
              </li>
            ))}
          </ul>
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
