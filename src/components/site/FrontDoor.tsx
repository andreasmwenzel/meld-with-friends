import Link from "next/link";
import type { ReactNode } from "react";
import { GitHubLink } from "@/components/site/GitHubLink";
import { Wordmark } from "@/components/site/Wordmark";
import { GameCard } from "@/components/site/GameCard";
import { CardBack } from "@/components/cards/CardBack";
import { MeldTable } from "@/components/site/MeldTable";
import { AuthPanel } from "@/components/site/AuthPanel";
import { GuestStart } from "@/components/site/GuestStart";
import { SignInToggle } from "@/components/site/SignInToggle";
import { HowToPlay } from "@/components/site/HowToPlay";

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

/** The house's games, held in one hand at the foot of the screen: a card for each, and one face down for the next. Decorative; it crops when space runs short. */
function HeldHand() {
  const cards = [<GameCard key="p" kind="pinochle" width={88} />, <GameCard key="h" kind="hearts" width={88} />, <CardBack key="b" width={88} team="red" />];
  return (
    <div aria-hidden className="pointer-events-none relative min-h-0 flex-1 overflow-hidden">
      <div className="absolute left-1/2 top-3 flex -translate-x-1/2" style={{ width: 88 + 2 * 48 }}>
        {cards.map((card, i) => (
          <div key={i} className="absolute bottom-0" style={{ left: i * 48, transformOrigin: "50% 130%", transform: `rotate(${(i - 1) * 9}deg)` }}>{card}</div>
        ))}
      </div>
    </div>
  );
}

/** The games, fanned beside the headline where the two short lines leave room. */
function GameFan() {
  const w = 64;
  return (
    <div aria-hidden className="pointer-events-none absolute right-0 top-1 hidden min-[380px]:block" style={{ width: w + 2 * 26, height: (w * 7) / 5 + 24 }}>
      {[<GameCard key="p" kind="pinochle" width={w} />, <GameCard key="h" kind="hearts" width={w} />, <CardBack key="b" width={w} team="red" />].map((card, i) => (
        <div key={i} className="absolute bottom-0" style={{ left: i * 26, zIndex: 3 - i, transformOrigin: "50% 140%", transform: `rotate(${(i - 1) * 10}deg)` }}>{card}</div>
      ))}
    </div>
  );
}

export function Welcome({ signIn = false }: { signIn?: boolean }) {
  return (
    <>
      <section className="relative flex min-h-0 shrink flex-col">
        <GameFan />
        <h1 className="display shrink-0" style={{ fontSize: "clamp(52px, 15vw, 92px)" }}>Pull up<br />a chair.</h1>
        <p className="mt-3 max-w-md shrink-0 text-chalk-faint leading-relaxed">
          Pinochle or hearts with your friends. Deal a table, send the six-letter code, and play. No account, no downloads, no strangers.
        </p>
        <div className="-mx-2 mt-5 min-h-0 overflow-y-auto overscroll-contain px-2 pb-1">
          <SignInToggle guest={<GuestStart />} signIn={<AuthPanel next="/" />} initial={signIn} />
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
          ["Choose your chair", "Sit anywhere that's open. To change seats, offer a swap and the other player accepts or declines."],
          ["Play", "Pinochle: bid, name trump, pass, lay your meld, take tricks. Hearts: pass three cards, avoid the hearts and the queen of spades. The scorepad keeps itself."],
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
        <h3 className="display" style={{ fontSize: 26 }}>Hearts: how it plays</h3>
        <p className="mb-2 mt-2 max-w-prose text-sm text-chalk-faint leading-relaxed">
          Four players, 52 cards, no partners. Pass three cards left, right, across, then hold. The two of clubs leads,
          and you follow suit when you can. You can&rsquo;t lead a heart until one has been played on another suit. Each
          heart you take scores 1 and the queen of spades scores 13. Take all 13 hearts and the queen and you shoot the
          moon: everyone else scores 26. The game ends when someone reaches 100, and the lowest score wins.
        </p>
      </section>
      <section>
        <h3 className="display" style={{ fontSize: 26 }}>Pinochle: what your meld is worth</h3>
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
