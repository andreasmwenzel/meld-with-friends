import Link from "next/link";
import type { ReactNode } from "react";
import type { Profile } from "@/lib/api";
import type { RulesPatch } from "@/components/rules/rules";
import type { TableSummary } from "@/lib/tableStatus";
import { AccountMenu } from "@/components/site/AccountMenu";
import { SiteHeader } from "@/components/site/SiteHeader";
import { DealTable } from "./DealTable";
import { Dock } from "./Dock";
import { Invitations, type Invitation } from "./Invitations";
import { TableList } from "./TableList";

/** The join link every lobby-style header carries; "Join" alone on a phone. */
export function JoinLink() {
  return (
    <Link href="/join" className="btn btn-ghost btn-compact">
      <span>Join<span className="hidden min-[400px]:inline"> with a code</span></span>
    </Link>
  );
}

/** A page off the lobby that scrolls as usual (past games): the same header, with the account passed in. */
export function LobbyFrame({ account, children }: { account?: ReactNode; children: ReactNode }) {
  return (
    <main className="flex-1">
      <SiteHeader account={account}><JoinLink /></SiteHeader>
      {children}
    </main>
  );
}

/**
 * The lobby, laid out like the table: one screen, never scrolling. The middle holds what you came for (tables you
 * sit at, invitations, dealing a new one); friends and groups wait in the dock at the foot, your account under your
 * initial in the corner. A long list of tables scrolls inside its own box.
 */
export function Lobby({ userId, profile, guest, tables, invites, autoDeal, defaults }: {
  userId: string; profile: (Profile & { default_rules?: unknown }) | null; guest: boolean; tables: TableSummary[]; invites: Invitation[];
  autoDeal: boolean; defaults: RulesPatch | null;
}) {
  const waiting = tables.filter((t) => t.yours).length;
  const first = profile?.display_name?.trim().split(/\s+/)[0] || "friend";
  return (
    <main className="flex h-dvh flex-col overflow-hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
      <SiteHeader account={profile && <AccountMenu me={profile} guest={guest} />}>
        <JoinLink />
      </SiteHeader>

      {/* Centred while it fits ("safe", so an overflowing top is never cut off); on a screen too short for even a few
          table rows (a phone held sideways) the middle scrolls as a whole instead of squeezing the list to nothing. */}
      <div className="mx-auto flex min-h-0 w-full max-w-xl flex-1 flex-col justify-center-safe overflow-y-auto overscroll-contain px-5 py-4 sm:px-6 lg:max-w-2xl">
        <h1 className="display shrink-0 text-[clamp(40px,11vw,68px)] short:text-[36px]">Evening, {first}.</h1>
        <p className="mt-3 shrink-0 text-chalk-faint">
          {tables.length === 0
            ? "You are not sitting anywhere yet. Deal a table, or join one with the code a friend sent you."
            : waiting === 0 ? "Nothing is waiting on you." : waiting === 1 ? "One table is waiting on you." : `${waiting} tables are waiting on you.`}
        </p>
        {/* Always mounted, so an invitation arriving live has somewhere to land; hidden while it holds nothing. */}
        <div className="-mx-2 mt-4 min-h-[7.5rem] overflow-y-auto overscroll-contain border-y border-chalk-ghost px-2 empty:hidden">
          <Invitations invites={invites} userId={guest ? null : userId} />
          {tables.length > 0 && <TableList tables={tables} />}
        </div>
        <div className="mt-6 flex shrink-0 flex-wrap items-center gap-x-6 gap-y-3">
          <DealTable autoOpen={autoDeal} defaults={defaults} saved={!guest} />
          <div className="flex gap-x-6">
            <Link href="/practice" className="tap text-sm text-chalk-faint underline-offset-4 hover:text-chalk hover:underline">Practice hand</Link>
            <Link href="/history" className="tap text-sm text-chalk-faint underline-offset-4 hover:text-chalk hover:underline">Past games</Link>
          </div>
        </div>
      </div>

      {profile && <div className="shrink-0 px-3 pb-4 pt-2 sm:pb-6"><Dock me={profile} guest={guest} /></div>}
    </main>
  );
}
