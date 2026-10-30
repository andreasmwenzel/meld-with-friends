"use client";

import type { Bid, CardId, HandRecord, MeldItem, Phase, Rank, SeatIndex, Suit, Team } from "@/engine/types";
import { RANK_LABEL, SUIT_GLYPH, cardName, splitCard, suitInk, suitInkOnCloth } from "@/components/cards/PlayingCard";
import { useCardPrefs } from "@/lib/cardPrefs";
import { teamOf } from "./types";
import { usePopover } from "./popover";

/** What a chip shows beside a player's name: the taker's contract and total, or a defender's own meld and counters. */
export interface SeatScore {
  dealer: boolean;
  /** the bid, "moon", or "–" for a pass */
  main: string | null; suit: Suit | null;
  /** the taking side's points this hand so far, or its change once the hand is scored */
  total: number | null;
  /** a defender's own meld, plus the counters in the tricks they have won once play starts */
  small: number | null;
  /** `small` includes the seat's counters, not only its meld */
  smallCounters: boolean;
  /** the breakdown behind the numbers: `top` (the bid), each melder's cards, then `rows` */
  top: [string, string][];
  meld: SeatMeld[];
  rows: [string, string][];
}

/** One player's meld in the breakdown: the cards of each piece, and what they came to. */
export interface SeatMeld { name: string; items: MeldItem[]; points: number }

/** The public facts a chip is built from; both the live view and a replay position provide them. */
export interface ScoreFacts {
  phase: Phase; handNumber: number; dealer: SeatIndex; bidder: SeatIndex | null; highBid: Bid | null; trump: Suit | null; bids: Bid[];
  sittingOut?: SeatIndex | null;
  meldPoints: Record<SeatIndex, number>;
  melds: Record<SeatIndex, MeldItem[]>;
  /** counter points taken by each side so far, without the last-trick bonus */
  counters: Record<Team, number>;
  /** the tricks taken so far: who won each and the counters in it */
  tricks: { winner: SeatIndex; counters: number }[];
  history: HandRecord[];
}

const SEATS: SeatIndex[] = [0, 1, 2, 3];
const EMPTY = (dealer: boolean): SeatScore => ({ dealer, main: null, suit: null, total: null, small: null, smallCounters: false, top: [], meld: [], rows: [] });

/**
 * Numbers only, no sentences: during bidding each chip shows its bid; afterwards the taker carries
 * the contract and the side's running total, each defender a small number for their own meld plus the
 * counters in the tricks they took themselves, the taker's partner nothing. `meldOut` lists zero melds too while meld lies on the table.
 */
export function seatScore(f: ScoreFacts, seat: SeatIndex, nameOf: (s: SeatIndex) => string, meldOut = false): SeatScore {
  const dealer = f.dealer === seat;
  if (f.phase === "bidding") {
    const bid = f.bids.filter(b => b.seat === seat).at(-1);
    return { ...EMPTY(dealer), main: bid ? (bid.amount === null ? "–" : bid.shoot ? "moon" : String(bid.amount)) : null };
  }
  const team = teamOf(seat);
  const record = f.history.find(h => h.handNumber === f.handNumber) ?? null;
  if (f.sittingOut != null && f.phase === "playing") {
    return f.bidder === seat ? { ...EMPTY(dealer), main: "moon", suit: f.trump, rows: [["Shoot", "Take every trick alone"]] } : EMPTY(dealer);
  }
  const playing = f.phase === "playing" || f.phase === "hand_over" || f.phase === "game_over";
  const meld = SEATS.filter(s => teamOf(s) === team).reduce((n: number, s) => n + f.meldPoints[s], 0);
  const soFar = meld + f.counters[team];
  const melded: SeatMeld[] = SEATS.filter(s => teamOf(s) === team && (f.meldPoints[s] > 0 || meldOut)).map(s => ({ name: nameOf(s), items: f.melds[s] ?? [], points: f.meldPoints[s] }));
  const rows: [string, string][] = [];
  if (playing && f.sittingOut == null) rows.push(["Counters", String(f.counters[team])]);
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
    return { dealer, main: f.highBid.shoot ? "moon" : String(f.highBid.amount), suit: f.trump, total, small: null, smallCounters: false, top: [["Bid", f.highBid.shoot ? "the moon" : String(f.highBid.amount)]], meld: melded, rows };
  }
  if (f.bidder !== null && teamOf(f.bidder) === team) return EMPTY(dealer);
  // A defender counts alone: their own meld and the counters in the tricks they won, not their partner's.
  if (f.sittingOut != null) return EMPTY(dealer);
  const own: SeatMeld[] = f.meldPoints[seat] > 0 || meldOut ? [{ name: nameOf(seat), items: f.melds[seat] ?? [], points: f.meldPoints[seat] }] : [];
  if (f.phase === "melding") return { ...EMPTY(dealer), small: f.meldPoints[seat], meld: own };
  if (!playing) return EMPTY(dealer);
  const counters = f.tricks.filter(t => t.winner === seat).reduce((n, t) => n + t.counters, 0);
  const lost = record != null && record.breakdown[team].meldDeclared > 0 && record.breakdown[team].meldSaved === 0 && f.meldPoints[seat] > 0;
  const mine = (lost ? 0 : f.meldPoints[seat]) + counters;
  const ownRows: [string, string][] = [["Counters", String(counters)]];
  if (lost) ownRows.push(["Meld lost, no trick", `-${f.meldPoints[seat]}`]);
  ownRows.push([record ? "Total" : "So far", String(mine)]);
  return { ...EMPTY(dealer), small: mine, smallCounters: true, meld: own, rows: ownRows };
}

function Rows({ rows, total = false }: { rows: [string, string][]; total?: boolean }) {
  if (!rows.length) return null;
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 tabular-nums">
      {rows.map(([k, v], i) => (
        <div key={i} className={`contents ${total && i === rows.length - 1 ? "font-semibold" : ""}`}><dt className="text-left text-ink-soft">{k}</dt><dd className="text-right">{v}</dd></div>
      ))}
    </dl>
  );
}

const RANK_ORDER: Rank[] = ["A", "T", "K", "Q", "J", "9"];
// Black and red alternate, so aces around never puts two reds side by side.
const SUIT_ORDER: Suit[] = ["S", "H", "C", "D"];
/** A piece's cards in reading order: by suit, then high to low (A 10 K Q J, Q♠ J♦). */
const inOrder = (cards: CardId[]) => [...cards].sort((a, b) => {
  const x = splitCard(a), y = splitCard(b);
  return SUIT_ORDER.indexOf(x.suit) - SUIT_ORDER.indexOf(y.suit) || RANK_ORDER.indexOf(x.rank) - RANK_ORDER.indexOf(y.rank);
});

/** A player's meld on one row of tiny overlapping cards, a small gap between pieces, and the points at the end. */
function MeldCards({ meld }: { meld: SeatMeld }) {
  const { prefs } = useCardPrefs();
  const said = meld.items.map(it => `${it.points} for ${inOrder(it.cards).map(cardName).join(", ")}`).join("; ");
  return (
    <div className="mt-0.5 first:mt-0">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-soft">{meld.name}</div>
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-h-7 flex-wrap items-center gap-y-1 py-0.5" aria-label={said || "no meld"} role="img">
          {meld.items.map((it, i) => (
            <span key={i} className={`flex ${i > 0 ? "ml-1" : ""}`}>
              {inOrder(it.cards).map((c, j) => {
                const { rank, suit } = splitCard(c);
                return (
                  <span key={j} style={{ color: suitInk(suit, prefs.fourColour) }}
                    className={`flex h-6 w-[18px] shrink-0 flex-col items-start rounded-[3px] bg-white pl-0.5 pt-0.5 text-[9px] font-bold leading-[10px] tracking-[-0.04em] shadow-[0_0_0_1px_rgba(36,29,29,0.28),-1px_0_2px_rgba(0,0,0,0.12)] ${j > 0 ? "-ml-1.5" : ""}`}>
                    <span>{RANK_LABEL[rank]}</span><span className="tracking-normal">{SUIT_GLYPH[suit]}</span>
                  </span>
                );
              })}
            </span>
          ))}
        </span>
        <span className="tabular-nums">{meld.points}</span>
      </div>
    </div>
  );
}

/** A small D on a player's avatar. Say "dealer" in the chip's accessible label; this is decorative. */
export function DealerMark() {
  return <span aria-hidden title="Dealer" className="absolute -bottom-1 -right-1 flex size-3.5 items-center justify-center rounded-full bg-chalk text-[9px] font-bold leading-none text-ink">D</span>;
}

/** The numbers beside a name. Tapping them opens the breakdown; Escape or a tap elsewhere closes it. */
/** `placement` is where the breakdown opens: above for your own seat, which sits at the bottom of the board. */
export function ScoreTag({ score, name, align, placement = "below" }: { score: SeatScore; name: string; align: "left" | "center" | "right"; placement?: "above" | "below" }) {
  const four = useCardPrefs().prefs.fourColour;
  // Wide meld rows can push the breakdown past a phone's edge: the popover nudges it back inside.
  const { open, setOpen, root, trigger, pop, id: popId, above, style: nudged } = usePopover(placement, JSON.stringify(score));
  if (score.main === null && score.small === null) return null;
  const detail = score.top.length + score.meld.length + score.rows.length > 0;
  const body = score.main !== null ? (
    <>
      <span className="font-semibold">{score.main}</span>
      {score.suit && <span style={{ color: suitInkOnCloth(score.suit, four) }}>{SUIT_GLYPH[score.suit]}</span>}
      {score.total !== null && <span className="ml-1 rounded-full bg-chalk/15 px-1.5 font-semibold tabular-nums">{score.total}</span>}
    </>
  ) : <span className="tabular-nums text-chalk-faint">{score.small}</span>;
  // "–" and "moon" read badly aloud: say what they mean.
  const call = score.main === "–" ? "passed" : score.main === "moon" ? "shooting the moon" : `bid ${score.main}`;
  const label = score.main !== null
    ? `${name}: ${call}${score.suit ? ` in ${{ S: "spades", H: "hearts", D: "diamonds", C: "clubs" }[score.suit]}` : ""}${score.total !== null ? `, ${score.total} this hand` : ""}`
    : score.smallCounters ? `${name}: ${score.small}, meld and counters taken` : `${name}: meld ${score.small}`;
  const side = align === "left" ? "left-0" : align === "right" ? "right-0" : "left-1/2 -translate-x-1/2";
  const cls = "flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs leading-5";
  // The chip stays 24px tall so nothing round it moves; the button's hit area reaches 44x44 (`hit`, globals.css).
  if (!detail) return <span className={cls}><span aria-hidden className="contents">{body}</span><span className="sr-only">{label}</span></span>;
  return (
    <div ref={root} className="relative">
      <button ref={trigger} type="button" aria-label={label} aria-expanded={open} aria-controls={open ? popId : undefined} onClick={() => setOpen(o => !o)}
        className={`${cls} hit hover:bg-chalk-ghost focus-visible:bg-chalk-ghost`}>
        {body}
      </button>
      {open && (
        <div ref={pop} id={popId} role="group" style={nudged} aria-label={name === "You" ? "Your side this hand" : `${name}'s side this hand`} className={`panel absolute z-30 w-max min-w-[150px] max-w-[min(280px,calc(100vw-16px))] ${above ? "bottom-full mb-1" : "top-full mt-1"} px-3 py-2 text-xs ${side}`}>
          <Rows rows={score.top} />
          {score.meld.length > 0 && (
            <div className={score.top.length ? "mt-1 border-t border-ink/10 pt-1" : ""}>
              {score.meld.map((m, i) => <MeldCards key={i} meld={m} />)}
            </div>
          )}
          {score.rows.length > 0 && (
            <div className={score.top.length || score.meld.length ? "mt-1 border-t border-ink/10 pt-1" : ""}><Rows rows={score.rows} total /></div>
          )}
        </div>
      )}
    </div>
  );
}
