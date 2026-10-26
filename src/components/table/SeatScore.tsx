"use client";

import { useEffect, useRef, useState } from "react";
import type { Bid, HandRecord, Phase, SeatIndex, Suit, Team } from "@/engine/types";
import { SUIT_GLYPH } from "@/components/cards/PlayingCard";
import { teamOf } from "./types";

/** What a chip shows beside a player's name: the taker's contract and total, or a defender's own meld. */
export interface SeatScore {
  dealer: boolean;
  /** the bid, "moon", or "–" for a pass */
  main: string | null; suit: Suit | null;
  /** the taking side's points this hand so far, or its change once the hand is scored */
  total: number | null;
  /** a defender's own meld */
  small: number | null;
  /** the breakdown behind the numbers */
  rows: [string, string][];
}

/** The public facts a chip is built from; both the live view and a replay position provide them. */
export interface ScoreFacts {
  phase: Phase; handNumber: number; dealer: SeatIndex; bidder: SeatIndex | null; highBid: Bid | null; trump: Suit | null; bids: Bid[];
  meldPoints: Record<SeatIndex, number>;
  /** counter points taken by each side so far, without the last-trick bonus */
  counters: Record<Team, number>;
  history: HandRecord[];
}

const SEATS: SeatIndex[] = [0, 1, 2, 3];
const EMPTY = (dealer: boolean): SeatScore => ({ dealer, main: null, suit: null, total: null, small: null, rows: [] });

/**
 * Numbers only, no sentences: during bidding each chip shows its bid; afterwards the taker carries
 * the contract and the side's running total, each defender a small number for their own meld, the
 * taker's partner nothing. `meldOut` lists zero melds too while meld lies on the table.
 */
export function seatScore(f: ScoreFacts, seat: SeatIndex, nameOf: (s: SeatIndex) => string, meldOut = false): SeatScore {
  const dealer = f.dealer === seat;
  if (f.phase === "bidding") {
    const bid = f.bids.filter(b => b.seat === seat).at(-1);
    return { ...EMPTY(dealer), main: bid ? (bid.amount === null ? "–" : bid.shoot ? "moon" : String(bid.amount)) : null };
  }
  const team = teamOf(seat);
  const record = f.history.find(h => h.handNumber === f.handNumber) ?? null;
  const playing = f.phase === "playing" || f.phase === "hand_over" || f.phase === "game_over";
  const meld = SEATS.filter(s => teamOf(s) === team).reduce((n: number, s) => n + f.meldPoints[s], 0);
  const soFar = meld + f.counters[team];
  const rows: [string, string][] = SEATS.filter(s => teamOf(s) === team && (f.meldPoints[s] > 0 || meldOut)).map(s => [`${nameOf(s)} meld`, String(f.meldPoints[s])]);
  if (playing) rows.push(["Counters", String(f.counters[team])]);
  if (record) {
    const b = record.breakdown[team];
    if (b.meldDeclared > 0 && b.meldSaved === 0) rows.push(["Meld lost, no trick", `-${b.meldDeclared}`]);
    if (b.lastTrick) rows.push(["Last trick", String(b.lastTrick)]);
    if (b.setPenalty) rows.push(["Set", `-${b.setPenalty}`]);
    if (b.shoot) rows.push(["Shoot", String(b.shoot)]);
    rows.push(["This hand", `${record.delta[team] > 0 ? "+" : ""}${record.delta[team]}`]);
  } else rows.push(["So far", String(soFar)]);
  if (f.bidder === seat && f.highBid) {
    const total = record ? record.delta[team] : f.phase === "melding" || playing ? soFar : null;
    return { dealer, main: f.highBid.shoot ? "moon" : String(f.highBid.amount), suit: f.trump, total, small: null, rows: [["Bid", f.highBid.shoot ? "the moon" : String(f.highBid.amount)], ...rows] };
  }
  if (f.bidder !== null && teamOf(f.bidder) === team) return EMPTY(dealer);
  return { ...EMPTY(dealer), small: f.phase === "melding" || f.phase === "playing" || record ? f.meldPoints[seat] : null, rows };
}

const SUIT_INK: Record<Suit, string> = { S: "var(--chalk)", C: "var(--chalk)", H: "var(--deck-red-soft)", D: "var(--deck-red-soft)" };

/** A small D on a player's avatar. Say "dealer" in the chip's accessible label; this is decorative. */
export function DealerMark() {
  return <span aria-hidden title="Dealer" className="absolute -bottom-1 -right-1 flex size-3.5 items-center justify-center rounded-full bg-chalk text-[9px] font-bold leading-none text-ink">D</span>;
}

/** The numbers beside a name. Tapping them opens the breakdown; Escape or a tap elsewhere closes it. */
export function ScoreTag({ score, name, align }: { score: SeatScore; name: string; align: "left" | "center" | "right" }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", key); };
  }, [open]);
  if (score.main === null && score.small === null) return null;
  const detail = score.rows.length > 0;
  const body = score.main !== null ? (
    <>
      <span className="font-semibold">{score.main}</span>
      {score.suit && <span style={{ color: SUIT_INK[score.suit] }}>{SUIT_GLYPH[score.suit]}</span>}
      {score.total !== null && <span className="ml-1 rounded-full bg-chalk/15 px-1.5 font-semibold tabular-nums">{score.total}</span>}
    </>
  ) : <span className="tabular-nums text-chalk-faint">{score.small}</span>;
  const label = score.main !== null
    ? `${name}: bid ${score.main}${score.suit ? ` in ${{ S: "spades", H: "hearts", D: "diamonds", C: "clubs" }[score.suit]}` : ""}${score.total !== null ? `, ${score.total} this hand` : ""}`
    : `${name}: meld ${score.small}`;
  const side = align === "left" ? "left-0" : align === "right" ? "right-0" : "left-1/2 -translate-x-1/2";
  const cls = "flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs leading-5";
  if (!detail) return <span aria-label={label} className={cls}>{body}</span>;
  return (
    <div ref={root} className="relative">
      <button type="button" aria-label={label} aria-expanded={open} onClick={() => setOpen(o => !o)}
        className={`${cls} hover:bg-chalk-ghost focus-visible:bg-chalk-ghost`}>
        {body}
      </button>
      {open && (
        <div role="dialog" aria-label={`${name}'s side this hand`} className={`panel absolute top-full z-30 mt-1 min-w-[150px] px-3 py-2 text-xs ${side}`}>
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 tabular-nums">
            {score.rows.map(([k, v], i) => (
              <div key={i} className={`contents ${i === score.rows.length - 1 ? "font-semibold" : ""}`}><dt className="text-left text-ink-soft">{k}</dt><dd className="text-right">{v}</dd></div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}
