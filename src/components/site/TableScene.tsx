import type { CSSProperties, ReactNode } from "react";
import { CardBack } from "@/components/cards/CardBack";
import { PlayingCard } from "@/components/cards/PlayingCard";
import type { CardId } from "@/engine/types";

/*
 * The pages between games: a dead end (no seat, no table, no page) or a wait (finding the table, dealing).
 * Each one sets out a few cards on the cloth that show what happened, so the message is the table itself
 * before it is a sentence.
 */

/** A dead end: the scene, a heading, what happened and the ways out. Beside the text once there is room, or on a phone held sideways. */
export function DeadEnd({ art, title, children, actions }: { art: ReactNode; title: ReactNode; children?: ReactNode; actions?: ReactNode }) {
  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-10 sm:flex-row sm:items-center sm:gap-14 sm:py-20 short:flex-row short:items-center short:gap-10 short:py-6">
      <div className="shrink-0 self-center">{art}</div>
      <div className="max-w-sm">
        <h1 className="display text-[clamp(36px,9vw,52px)] short:text-[36px]">{title}</h1>
        {children && <div className="mt-3 leading-relaxed text-chalk-faint">{children}</div>}
        {actions && <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2">{actions}</div>}
      </div>
    </section>
  );
}

/** A wait: the deck deals round the table until whatever was asked for arrives. */
export function Dealing({ label }: { label: string }) {
  return (
    <div role="status" className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-16 short:py-6">
      <DealingDeck />
      <p className="text-chalk-faint">{label}</p>
    </div>
  );
}

/** One thing placed on the scene: centred on (x, y), turned by r degrees. */
function At({ x, y, r = 0, z, className, style, children }: { x: number; y: number; r?: number; z?: number; className?: string; style?: CSSProperties; children: ReactNode }) {
  return (
    <div className={`absolute ${className ?? ""}`} style={{ left: x, top: y, zIndex: z, transform: `translate(-50%, -50%) rotate(${r}deg)`, ...style }}>
      {children}
    </div>
  );
}

function Scene({ w, h, children }: { w: number; h: number; children: ReactNode }) {
  return <div aria-hidden className="relative" style={{ width: w, height: h }}>{children}</div>;
}

/** Where each seat's cards land, from the middle of the dealing scene: across, right, you, left. */
const DEAL_W = 220, DEAL_H = 168, DEAL_CARD = 34;
const SEATS = [
  { dx: 0, dy: -58, r: 0 },
  { dx: 86, dy: 0, r: 90 },
  { dx: 0, dy: 58, r: 0 },
  { dx: -86, dy: 0, r: -90 },
];

/** The deck in the middle and eight cards going out one at a time, a round apiece, then gathered up and dealt again. */
export function DealingDeck() {
  return (
    <Scene w={DEAL_W} h={DEAL_H}>
      {[2, 1, 0].map((i) => <At key={i} x={DEAL_W / 2 - i} y={DEAL_H / 2 - i}><CardBack width={DEAL_CARD} /></At>)}
      {Array.from({ length: 8 }, (_, i) => {
        const seat = SEATS[i % 4], round = i < 4 ? 0 : 1;
        // The second round lands a little over the first, so each seat ends with a small pile.
        const off = round * 4;
        return (
          <div key={i} className="deal-card absolute" style={{
            left: DEAL_W / 2 - DEAL_CARD / 2, top: DEAL_H / 2 - (DEAL_CARD * 7) / 10, zIndex: 10 + i, animationName: `deal-${i}`,
            "--dx": `${seat.dx + (seat.r ? 0 : off)}px`, "--dy": `${seat.dy + (seat.r ? off : 0)}px`, "--dr": `${seat.r + (round ? 4 : -3)}deg`,
          } as CSSProperties}>
            <CardBack width={DEAL_CARD} team={i % 2 ? "red" : "blue"} />
          </div>
        );
      })}
    </Scene>
  );
}

/** n cards spread round a centre: x and y step apart, turned a few degrees each, bowed a little like a hand. */
function spread(n: number, step: number, turn: number) {
  return Array.from({ length: n }, (_, i) => {
    const k = i - (n - 1) / 2;
    return { k, along: k * step, r: k * turn, bow: Math.abs(k) * Math.abs(k) * 1.2 };
  });
}

/** A game under way without you: three hands and a trick on the table, and a dotted outline where your hand would be. */
export function EmptySeat() {
  const w = 248, h = 214, cw = 30;
  return (
    <Scene w={w} h={h}>
      <div className="absolute inset-x-6 inset-y-5 rounded-[40px]" style={{ boxShadow: "inset 0 0 0 1.5px var(--chalk-ghost)" }} />
      {spread(5, 13, 7).map(({ k, along, r, bow }) => <At key={`n${k}`} x={w / 2 + along} y={34 + bow} r={180 + r}><CardBack width={cw} /></At>)}
      {spread(5, 12, 7).map(({ k, along, r, bow }) => <At key={`w${k}`} x={30 + bow} y={h / 2 + along} r={90 + r}><CardBack width={cw} team="red" /></At>)}
      {spread(5, 12, 7).map(({ k, along, r, bow }) => <At key={`e${k}`} x={w - 30 - bow} y={h / 2 - along} r={-90 + r}><CardBack width={cw} team="red" /></At>)}
      <At x={w / 2 - 14} y={h / 2 - 4} r={-9}><PlayingCard card="KH0" width={34} /></At>
      <At x={w / 2 + 8} y={h / 2 - 12} r={6} z={1}><PlayingCard card="AH0" width={34} /></At>
      {spread(5, 15, 7).map(({ k, along, r, bow }) => (
        <At key={`s${k}`} x={w / 2 + along} y={h - 34 + bow} r={r}>
          <div className="rounded-[4px]" style={{ width: cw + 4, height: ((cw + 4) * 7) / 5, border: "1.5px dashed rgba(245, 239, 227, .42)", background: "rgba(0, 0, 0, .08)" }} />
        </At>
      ))}
    </Scene>
  );
}

/** A table code spelled out a letter to a card, held like a hand. */
export function CodeHand({ code }: { code: string }) {
  const letters = code.slice(0, 8).split("");
  const cw = 46, w = 56 + letters.length * 33, h = 112;
  return (
    <Scene w={w} h={h}>
      {spread(letters.length, 33, 6).map(({ k, along, r, bow }, i) => (
        <At key={k} x={w / 2 + along} y={h / 2 + 4 + bow * 1.5} r={r}>
          <svg viewBox="0 0 100 140" width={cw} height={(cw * 7) / 5} style={{ display: "block", borderRadius: 4, boxShadow: "0 0 0 1px rgba(36, 29, 29, .16), var(--shadow-card)" }}>
            <rect width="100" height="140" rx="8.5" fill="var(--chalk)" />
            <g fill="var(--ink)" fontFamily="var(--font-bodoni), serif">
              <text x="9" y="26" fontSize="22" fontWeight={600}>{letters[i]}</text>
              <text x="50" y="96" textAnchor="middle" fontSize="64" fontStyle="italic" fontWeight={600}>{letters[i]}</text>
            </g>
          </svg>
        </At>
      ))}
    </Scene>
  );
}

/** A two of clubs: a card that is not in a pinochle deck. Drawn like PlayingCard's number cards. */
function TwoOfClubs({ width }: { width: number }) {
  return (
    <svg viewBox="0 0 100 140" width={width} height={(width * 7) / 5}
      style={{ display: "block", borderRadius: Math.max(4, width * 0.085), boxShadow: "0 0 0 1px rgba(36, 29, 29, .16), var(--shadow-card)" }}>
      <rect width="100" height="140" rx="8.5" fill="var(--chalk)" />
      <g fill="var(--pip-black)" fontFamily="var(--font-bodoni), serif" fontWeight={600}>
        <text x="7" y="25" fontSize="24">2</text>
        <text x="7" y="44" fontSize="19">♣</text>
        <g transform="rotate(180 50 70)">
          <text x="7" y="25" fontSize="24">2</text>
          <text x="7" y="44" fontSize="19">♣</text>
        </g>
      </g>
      <g fill="var(--pip-black)" fontSize="26" textAnchor="middle">
        <text x="50" y="52">♣</text>
        <text x="50" y="106" transform="rotate(180 50 97)">♣</text>
      </g>
    </svg>
  );
}

const SPADES: CardId[] = ["9S0", "JS0", "QS0", "KS0", "TS0", "AS0"];

/** A run of spades, nine to ace, and a two of clubs lifted out of the hand because it does not belong there. */
export function StrayCard() {
  const w = 252, h = 196, cw = 52;
  return (
    <Scene w={w} h={h}>
      {spread(SPADES.length, 26, 6).map(({ k, along, r, bow }, i) => (
        <At key={k} x={w / 2 + along} y={h - 52 + bow * 1.6} r={r}><PlayingCard card={SPADES[i]} width={cw} /></At>
      ))}
      <At x={w / 2 + 42} y={50} r={11} z={2}><TwoOfClubs width={cw + 4} /></At>
    </Scene>
  );
}

/** Two teams' taken tricks, squared and face down. Knocked out of true when the record no longer lines up. */
export function TrickPiles({ askew = false }: { askew?: boolean }) {
  const w = 236, h = 150, cw = 50;
  const tilt = askew ? [-38, 24, -9, 52, -21, 13] : [-2, 1, -1, 2, 0, -1];
  const slide = askew ? [[-18, 10], [16, -8], [-6, -14], [24, 12], [-12, 4], [6, -6]] : [[0, 0], [1, -1], [0, -2], [1, -3], [0, -4], [1, -5]];
  return (
    <Scene w={w} h={h}>
      {(["blue", "red"] as const).map((team, p) => tilt.map((t, i) => (
        <At key={`${team}${i}`} x={w / 2 + (p ? 52 : -52) + slide[i][0] * (p ? -1 : 1)} y={h / 2 + 6 + slide[i][1]} r={(p ? -t : t) + (p ? 5 : -5)}>
          <CardBack width={cw} team={team} />
        </At>
      )))}
    </Scene>
  );
}
