import Link from "next/link";
import { GitHubLink } from "@/components/site/GitHubLink";
import { Suspense } from "react";
import { Fan } from "@/components/cards/Fan";
import { CardBack } from "@/components/cards/PlayingCard";
import { Wordmark } from "@/components/site/Wordmark";
import { MeldTable } from "@/components/site/MeldTable";
import { AuthPanel } from "@/components/site/AuthPanel";
import { GuestStart } from "@/components/site/GuestStart";
import { SignInToggle } from "@/components/site/SignInToggle";
import { getSessionUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { RulesPatch } from "@/components/rules/rules";

export default function Landing() {
  return (
    <main className="flex-1">
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-6 py-5 sm:py-6">
        <Wordmark size={30} />
        <nav className="flex items-center gap-2">
          <Link href="/join" className="btn btn-ghost btn-compact">Join with a code</Link>
          <Suspense><HeaderUserLink /></Suspense>
        </nav>
      </header>

      <section className="mx-auto grid max-w-6xl items-end gap-10 px-6 pb-16 pt-6 sm:gap-12 sm:pb-20 sm:pt-10 lg:grid-cols-[1.1fr_1fr]">
        <div className="min-w-0">
          <h1 className="display" style={{ fontSize: "clamp(56px, 9vw, 124px)" }}>
            Pull up<br />a chair.
          </h1>
          <p className="mt-7 max-w-md text-lg text-chalk-faint leading-relaxed">
            Meld is a free online table for pinochle with your friends. Deal a table, hand out a
            six-letter code, pick your seats, and play in real time. No account, no downloads, no strangers.
          </p>
          <div className="mt-8 max-w-md">
            <Suspense fallback={<div className="panel p-6" style={{ minHeight: 252 }} />}>
              <HeroAction />
            </Suspense>
          </div>
        </div>

        <figure className="relative mx-auto w-full min-w-0 max-w-[520px] lg:mx-0 lg:justify-self-end">
          <div className="absolute -left-6 -top-4 hidden rotate-[-9deg] sm:block">
            <CardBack width={88} team="red" />
          </div>
          <div className="absolute -right-2 top-8 hidden rotate-[7deg] sm:block">
            <CardBack width={88} team="blue" />
          </div>
          <Fan cards={["AS0", "TS0", "KS0", "QS0", "JS0", "JD0"]} width={84} spread={7} className="relative mx-auto sm:hidden" />
          <Fan cards={["AS0", "TS0", "KS0", "QS0", "JS0", "JD0"]} width={128} spread={7} className="relative mx-auto hidden sm:block" />
          <figcaption className="mt-2 flex items-baseline justify-between text-chalk-faint">
            <span>A run in spades and a pinochle.</span>
            <span className="display text-chalk" style={{ fontSize: 30 }}>190</span>
          </figcaption>
        </figure>
      </section>

      <section className="border-t border-chalk-ghost">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 py-16 md:grid-cols-[1fr_2fr]">
          <h2 className="display" style={{ fontSize: 40 }}>How a table works</h2>
          <ol className="grid gap-6 sm:grid-cols-2">
            {[
              ["Deal a table", "Type your name and deal. No account needed. You get a six-letter code."],
              ["Hand out the code", "Text it, or invite from your friends list. Everyone lands at the same table."],
              ["Choose your chair", "Sit anywhere that's open. Want to switch partners? Offer a trade and the other player accepts or declines."],
              ["Play", "Bid, name trump, pass, lay your meld, take tricks. The scorepad keeps itself."],
            ].map(([title, body], i) => (
              <li key={title} className="flex gap-4">
                <span className="display text-chalk-faint" style={{ fontSize: 34, lineHeight: 1 }}>{i + 1}</span>
                <div>
                  <h3 className="text-lg font-semibold">{title}</h3>
                  <p className="mt-1 text-chalk-faint leading-relaxed">{body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="border-t border-chalk-ghost">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
            <h2 className="display" style={{ fontSize: 40 }}>What your meld is worth</h2>
            <p className="max-w-sm text-chalk-faint">
              Four-hand partnership pinochle, 48 cards, first to 150. Counters are aces, tens and kings
              at one apiece, plus one for the last trick. Classic ×10 scoring is a table option.
            </p>
          </div>
          <MeldTable />
        </div>
      </section>

      <footer className="border-t border-chalk-ghost">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-8 text-sm text-chalk-faint">
          <Wordmark size={22} />
          <p className="flex items-center gap-2">Pinochle today. Other card games as the table fills up. <GitHubLink className="-my-2" /></p>
        </div>
      </footer>
    </main>
  );
}

async function HeaderUserLink() {
  const user = await getSessionUser();
  return user ? <Link href="/home" className="btn btn-chalk btn-compact">Your tables</Link> : null;
}

async function HeroAction() {
  const user = await getSessionUser();
  if (!user) return (
    <>
      <SignInToggle guest={<GuestStart />} signIn={<AuthPanel />} />
      <p className="mt-4 text-sm text-chalk-faint">
        New to pinochle? <Link href="/practice" className="text-chalk underline underline-offset-4 hover:text-brass">Play a practice hand.</Link>
      </p>
    </>
  );
  const supabase = await createClient();
  const { data: profile } = await supabase.from("profiles").select("default_rules").eq("id", user.id).maybeSingle();
  return (
    <div className="flex flex-col gap-3">
      <GuestStart signedIn defaults={(profile?.default_rules as RulesPatch | null) ?? null} />
      <Link href="/home" className="text-sm text-chalk-faint hover:text-chalk">Your tables and friends</Link>
    </div>
  );
}
