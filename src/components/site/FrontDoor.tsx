import Link from "next/link";
import type { ReactNode } from "react";
import { GitHubLink } from "@/components/site/GitHubLink";
import { Fan } from "@/components/cards/Fan";
import { Wordmark } from "@/components/site/Wordmark";
import { MeldTable } from "@/components/site/MeldTable";
import { AuthPanel } from "@/components/site/AuthPanel";
import { GuestStart } from "@/components/site/GuestStart";
import { SignInToggle } from "@/components/site/SignInToggle";
import { HowToPlay } from "@/components/site/HowToPlay";
import { TableList } from "@/components/lobby/TableList";
import { NameChange } from "@/components/site/NameChange";
import { LiveRefresh } from "@/components/lobby/LiveRefresh";
import type { TableSummary } from "@/lib/tableStatus";
import type { RulesPatch } from "@/components/rules/rules";

/** The front door frame: one screen tall, never scrolls; only the table list scrolls inside it. */
export function FrontDoor({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex h-dvh w-full max-w-xl flex-col overflow-hidden px-5 sm:px-6"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
      <header className="flex shrink-0 items-center justify-between gap-3 py-4">
        <Wordmark size={28} />
        <HowToPlay><Rules /></HowToPlay>
      </header>
      {children}
    </main>
  );
}

/** Your hand, held at the bottom edge of the screen. Purely decorative; it crops when space runs short. */
function HeldHand({ centred = false }: { centred?: boolean }) {
  return (
    <div aria-hidden className="pointer-events-none relative min-h-0 flex-1 overflow-hidden">
      <div className={`absolute left-1/2 -translate-x-1/2 ${centred ? "top-1/2 -translate-y-1/2" : "top-3"}`}>
        <Fan cards={["AS0", "TS0", "KS0", "QS0", "JS0", "JD0"]} width={80} spread={8} />
      </div>
    </div>
  );
}

export function Welcome() {
  return (
    <>
      <section className="flex min-h-0 shrink flex-col">
        <h1 className="display shrink-0" style={{ fontSize: "clamp(52px, 15vw, 92px)" }}>Pull up<br />a chair.</h1>
        <p className="mt-3 max-w-md shrink-0 text-chalk-faint leading-relaxed">
          Pinochle with your friends. Deal a table, send the six-letter code, and play. No account, no downloads, no strangers.
        </p>
        <div className="-mx-2 mt-5 min-h-0 overflow-y-auto overscroll-contain px-2 pb-1">
          <SignInToggle guest={<GuestStart />} signIn={<AuthPanel next="/" />} />
        </div>
      </section>
      <Foot>
        <Link href="/practice" className="tap-link text-chalk-faint hover:text-chalk">Play a practice hand</Link>
        <GitHubLink />
      </Foot>
      <HeldHand />
    </>
  );
}

export function Returning({ name, fullName, guest, tables, defaults, live = true }: {
  name: string | null; fullName?: string | null; guest: boolean; tables: TableSummary[]; defaults: RulesPatch | null; live?: boolean;
}) {
  const waiting = tables.filter((t) => t.yours).length;
  const lede = !tables.length
    ? "You are not sitting at a table yet. Deal one and send the code, or type the code a friend sent you."
    : waiting === 0 ? "Nothing is waiting on you right now."
    : waiting === 1 ? "One table is waiting on you." : `${waiting} tables are waiting on you.`;
  return (
    <>
      <section className="shrink-0">
        <h1 className="display" style={{ fontSize: "clamp(38px, 10.5vw, 60px)" }}>Evening, {name ?? "friend"}.</h1>
        <p className="mt-1.5 text-chalk-faint">{lede}</p>
        {fullName && <div className="mt-1"><NameChange name={fullName} /></div>}
      </section>
      {tables.length ? (
        <section aria-label="Your tables" className="mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-chalk-ghost">
          <TableList tables={tables} />
        </section>
      ) : <HeldHand centred />}
      <div className="-mx-2 mt-4 max-h-[62dvh] shrink-0 overflow-y-auto overscroll-contain px-2 pt-1">
        <GuestStart signedIn defaults={defaults} />
      </div>
      <Foot>
        <Link href="/practice" className="tap-link text-chalk-faint hover:text-chalk">Practice hand</Link>
        <Link href="/home" className="tap-link text-chalk-faint hover:text-chalk">
          {guest ? "Keep your account" : "Friends and past games"}
        </Link>
      </Foot>
      {live && <LiveRefresh />}
    </>
  );
}

function Foot({ children }: { children: ReactNode }) {
  return <footer className="flex shrink-0 items-center justify-between gap-4 py-2 text-sm">{children}</footer>;
}

function Rules() {
  return (
    <div className="flex flex-col gap-8">
      <ol className="grid gap-5 sm:grid-cols-2">
        {[
          ["Deal a table", "Type your name and deal. No account needed. You get a six-letter code."],
          ["Hand out the code", "Text it, or invite from your friends list. Everyone lands at the same table."],
          ["Choose your chair", "Sit anywhere that's open. To switch partners, offer a trade and the other player accepts or declines."],
          ["Play", "Bid, name trump, pass, lay your meld, take tricks. The scorepad keeps itself."],
        ].map(([title, body], i) => (
          <li key={title} className="flex gap-4">
            <span className="display text-chalk-faint" style={{ fontSize: 30, lineHeight: 1 }}>{i + 1}</span>
            <div>
              <h3 className="font-semibold">{title}</h3>
              <p className="mt-1 text-sm text-chalk-faint leading-relaxed">{body}</p>
            </div>
          </li>
        ))}
      </ol>
      <section>
        <h3 className="display" style={{ fontSize: 26 }}>What your meld is worth</h3>
        <p className="mb-5 mt-2 max-w-prose text-sm text-chalk-faint leading-relaxed">
          Four-hand partnership pinochle, 48 cards, first to 150. Counters are aces, tens and kings at one
          apiece, plus one for the last trick. Classic ×10 scoring is a table option.
        </p>
        <MeldTable />
      </section>
      <p className="text-sm text-chalk-faint">
        New to pinochle? <Link href="/practice" className="text-chalk underline underline-offset-4 hover:text-brass">Play a practice hand</Link> with
        a coach that suggests each move.
      </p>
    </div>
  );
}
