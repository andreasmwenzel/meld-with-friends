import Link from "next/link";
import type { ReactNode } from "react";
import type { Profile } from "@/lib/api";
import type { RulesPatch } from "@/components/rules/rules";
import type { TableSummary } from "@/lib/tableStatus";
import { GitHubLink } from "@/components/site/GitHubLink";
import { KeepAccount } from "@/components/site/KeepAccount";
import { SignOut } from "@/components/site/SignOut";
import { Wordmark } from "@/components/site/Wordmark";
import { DealTable } from "./DealTable";
import { Friends } from "./Friends";
import { Invitations, type Invitation } from "./Invitations";
import { ProfileEditor } from "./ProfileEditor";
import { TableList } from "./TableList";

/** The lobby's page: the wordmark with join, sign out and source links across the top. */
export function LobbyFrame({ children }: { children: ReactNode }) {
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
      {children}
    </main>
  );
}

/**
 * The lobby: tables you sit at and tables you are invited to come first, then dealing a new one,
 * with links to a practice hand and past games (/history) beside it. House rules are set in the
 * deal panel, which remembers the last ones dealt.
 */
export function Lobby({ userId, profile, guest, tables, invites, autoDeal, defaults }: {
  userId: string; profile: (Profile & { default_rules?: unknown }) | null; guest: boolean; tables: TableSummary[]; invites: Invitation[];
  autoDeal: boolean; defaults: RulesPatch | null;
}) {
  const waiting = tables.filter((t) => t.yours).length;
  return (
    <div className="mx-auto grid max-w-6xl gap-14 px-6 pb-16 pt-4 sm:pb-20 sm:pt-6 lg:grid-cols-[1.2fr_1fr]">
      <section>
        <h1 className="display" style={{ fontSize: "clamp(40px, 6vw, 72px)" }}>
          Evening, {profile?.display_name?.split(" ")[0] ?? "friend"}.
        </h1>
        {profile && <div id="profile" className="mt-3 scroll-mt-4"><ProfileEditor me={profile} /></div>}
        <Invitations invites={invites} userId={guest ? null : userId} />
        <div className="mt-8 flex items-baseline justify-between gap-4">
          <h2 className="display" style={{ fontSize: 34 }}>Your tables</h2>
          {tables.length > 0 && (
            <p className="text-sm text-chalk-faint">{waiting === 0 ? "Nothing is waiting on you" : waiting === 1 ? "One is waiting on you" : `${waiting} are waiting on you`}</p>
          )}
        </div>
        {tables.length === 0 ? (
          <p className="mt-3 max-w-md text-chalk-faint">
            You are not sitting anywhere yet. Deal a table below, or join one with the code a friend sent you.
          </p>
        ) : (
          <div className="mt-2"><TableList tables={tables} /></div>
        )}
        <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
          <DealTable autoOpen={autoDeal} defaults={defaults} saved={!guest} />
          {/* The two links wrap together, so on a phone they share a line under the button. */}
          <div className="flex gap-x-6">
            <Link href="/practice" className="tap text-sm text-chalk-faint underline-offset-4 hover:text-chalk hover:underline">Practice hand</Link>
            <Link href="/history" className="tap text-sm text-chalk-faint underline-offset-4 hover:text-chalk hover:underline">Past games</Link>
          </div>
        </div>
      </section>
      {profile && (guest ? (
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
