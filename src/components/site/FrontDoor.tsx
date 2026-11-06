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

/**
 * The front door frame: one screen tall where everything fits, with the held hand filling what is left.
 * When the screen is too short for the form (a small phone, a phone held sideways) the page scrolls
 * instead of hiding fields inside a clipped box.
 */
export function FrontDoor({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-5 sm:px-6 short:max-w-4xl"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
      <header className="flex shrink-0 items-center justify-between gap-3 py-4 short:py-2">
        <Wordmark size={28} />
        <HowToPlay><Rules /></HowToPlay>
      </header>
      {children}
    </main>
  );
}

/** A hand held face down at the bottom edge of the screen, whichever game it is for. Decorative; it crops when space runs short. */
function HeldHand() {
  const n = 6, w = 80;
  return (
    <div aria-hidden className="pointer-events-none relative min-h-0 flex-1 overflow-hidden short:hidden">
      <div className="absolute left-1/2 top-3 -translate-x-1/2" style={{ width: w + (n - 1) * w * 0.42, height: (w * 7) / 5 + 40 }}>
        {Array.from({ length: n }, (_, i) => (
          <div key={i} className="absolute top-0" style={{ left: i * w * 0.42, transformOrigin: "50% 120%", transform: `rotate(${(i - (n - 1) / 2) * 8}deg)` }}>
            <CardBack width={w} team={i % 2 ? "blue" : "red"} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** The games, fanned beside the headline where the two short lines leave room. Smaller on phones so it clears "chair.". */
function GameFan() {
  const w = 64;
  return (
    <div aria-hidden className="pointer-events-none absolute right-3 top-1 hidden origin-top-right scale-75 min-[380px]:block min-[480px]:scale-100 short:hidden!" style={{ width: w + 2 * 46, height: (w * 7) / 5 + 24 }}>
      {[<CardBack key="b" width={w} team="red" />, <GameCard key="p" kind="pinochle" width={w} />, <GameCard key="h" kind="hearts" width={w} />].map((card, i) => (
        <div key={i} className="absolute bottom-0" style={{ left: i * 46, zIndex: i, transformOrigin: "50% 140%", transform: `rotate(${(i - 1) * 10}deg)` }}>{card}</div>
      ))}
    </div>
  );
}

export function Welcome({ signIn = false }: { signIn?: boolean }) {
  return (
    <>
      {/* Sideways on a phone the headline and the form sit side by side, so the form starts on the first screen. */}
      <section className="relative flex shrink-0 flex-col short:grid short:grid-cols-[minmax(0,1fr)_minmax(0,min(30rem,58%))] short:items-start short:gap-x-8">
        <GameFan />
        <div>
          {/* Sized by height as well as width, so a short screen keeps room for the form. The class is the fallback where dvh is unknown. */}
          <h1 className="display text-[clamp(52px,15vw,92px)]" style={{ fontSize: "clamp(44px, min(15vw, 11dvh), 92px)" }}>Pull up<br />a chair.</h1>
          <p className="mt-3 max-w-md text-chalk-faint leading-relaxed">
            Pinochle or hearts with your friends. Deal a table, send the six-letter code, and play. No account, no downloads, no strangers.
          </p>
        </div>
        <div className="-mx-2 mt-5 px-2 pb-1 short:mt-0">
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
