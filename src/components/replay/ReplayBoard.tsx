"use client";

import type { CardId, GameState, SeatIndex, Suit, Team, Trick } from "@/engine/types";
import { sortHand } from "@/engine/hand";
import { PlayingCard, SUIT_GLYPH } from "@/components/cards/PlayingCard";
import { Avatar } from "@/components/site/Avatar";
import { useCardPrefs } from "@/lib/cardPrefs";
import { teamOf } from "@/components/table/types";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { viewFor } from "@/engine/game";
import { useTableTurn } from "@/components/table/turn";
import { flyFrom, motionTimings, sweepTo } from "@/components/table/motion";
import type { Move } from "./model";

interface SeatInfo { name: string; bot: boolean }
/** What a chip shows beside the name: the taker's contract and total, or a defender's own meld. */
interface SeatScore {
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
type Rel = 0 | 1 | 2 | 3;
/** Each seat's hand, as an offset (px) from the middle of the table, by position round the viewer. */
const SEAT_AT: Record<"phone" | "desktop", Record<Rel, [number, number]>> = {
  phone: { 0: [0, 240], 1: [-165, 0], 2: [0, -210], 3: [165, 0] },
  desktop: { 0: [0, 300], 1: [-300, 0], 2: [0, -260], 3: [300, 0] },
};
/** A flight that lands in a hand: starts `from` (an offset from the table's middle) and ends where the card sits. */
function flight(from: [number, number], to: [number, number], delayMs = 0, durationMs?: number): CSSProperties {
  return {
    "--fx": `${from[0] - to[0]}px`, "--fy": `${from[1] - to[1]}px`, "--fr": "0deg", "--fs": 0.9,
    animationDelay: delayMs ? `${delayMs}ms` : undefined, animationDuration: durationMs ? `${durationMs}ms` : undefined,
  } as CSSProperties;
}

/**
 * The table with every hand face up, as it stood after one move. The reader's seat sits at the
 * bottom; the seat that moved wears the turn ring, and the cards the move touched are lifted.
 */
export function ReplayBoard({ frame, move, bottom, seats, viewerSeat, onSit, animate = false }: {
  frame: GameState; move: Move; bottom: SeatIndex; seats: Record<SeatIndex, SeatInfo>;
  /** the reader's own seat in this game, if they played */
  viewerSeat: SeatIndex | null;
  /** tap a player to bring their chair to the bottom */
  onSit: (seat: SeatIndex) => void;
  /** the reader stepped forward one move, so the cards it moved travel */
  animate?: boolean;
}) {
  const { prefs, phone, reducedMotion } = useCardPrefs();
  const turn = useTableTurn(bottom);
  // The chips change places when the table turns; keyboard focus follows the chair the reader chose.
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!root.current?.contains(document.activeElement) || !document.activeElement?.closest("[data-chip]")) return;
    root.current.querySelector<HTMLElement>('[data-chip][aria-pressed="true"]')?.focus();
  }, [bottom]);
  const motion = reducedMotion ? "off" : prefs.motion;
  const { slideMs, holdMs, sweepMs } = motionTimings(motion);
  const seatAt = (r: number): SeatIndex => (((bottom + r) % 4) as SeatIndex);
  const rel = (seat: SeatIndex): 0 | 1 | 2 | 3 => (((seat - bottom + 4) % 4) as 0 | 1 | 2 | 3);
  const lit = new Set(move.cards);
  // Meld lies on the table in front of each player from the first lay-down until the first lead.
  const meldOut = frame.phase === "melding" || move.kind === "meld";
  const meldOf = (seat: SeatIndex): CardId[] => meldOut ? sortHand([...new Set(frame.players[seat].meld.flatMap(item => item.cards))], frame.trump, prefs.sort) : [];
  const hand = (seat: SeatIndex) => {
    const out = new Set(meldOf(seat));
    return sortHand(frame.players[seat].hand.filter(c => !out.has(c)), frame.trump, prefs.sort);
  };
  // Lit cards lift wherever they now sit: a pass lights up in the hand that received it.
  const raised = (seat: SeatIndex): Set<CardId> => new Set<CardId>(frame.players[seat].hand.filter(c => lit.has(c)));
  const trick: Trick | null = frame.currentTrick?.plays.length ? frame.currentTrick : move.trick;
  const at = SEAT_AT[phone ? "phone" : "desktop"];
  // Cards in flight this move: a pass travels from the passer's hand, a deal fans out from the middle.
  const flights = new Map<CardId, CSSProperties>();
  if (animate && move.kind === "pass" && move.actor !== null) {
    for (const seat of [0, 1, 2, 3] as SeatIndex[]) for (const c of frame.players[seat].hand) if (lit.has(c)) flights.set(c, flight(at[rel(move.actor)], at[rel(seat)]));
  }
  if (animate && move.kind === "deal") {
    // In deal order: one card at a time round the table from the dealer's left, as the engine deals.
    const stagger = motion === "off" ? 0 : 28;
    for (const seat of [0, 1, 2, 3] as SeatIndex[]) {
      const order = (seat - frame.dealer + 3) % 4;
      frame.players[seat].hand.forEach((c, i) => flights.set(c, flight([0, 0], at[rel(seat)], (i * 4 + order) * stagger, motion === "off" ? undefined : 360)));
    }
  }
  if (animate && move.kind === "meld") {
    // Laid down from the hand: a short slide toward the middle.
    for (const seat of [0, 1, 2, 3] as SeatIndex[]) for (const c of meldOf(seat)) if (lit.has(c)) {
      const [x, y] = at[rel(seat)];
      flights.set(c, flight([x, y], [x * 0.75, y * 0.75], 0, 320));
    }
  }
  const flying: CardId | null = animate && move.kind === "play" ? move.cards[0] ?? null : null;
  // Numbers only, no sentences: the taker carries the contract and the side's running total, each
  // defender a small number for their own meld. The breakdown is a tap away.
  const view = viewFor(frame, 0);
  const recap = view.recap;
  const sideTotal = (team: Team) => {
    const meld = frame.players.filter(p => teamOf(p.seat) === team).reduce((n, p) => n + p.meldPoints, 0);
    return meld + recap.counters[team];
  };
  const scoreOf = (seat: SeatIndex): SeatScore => {
    const bid = frame.bids.filter(b => b.seat === seat).at(-1);
    const dealer = frame.dealer === seat;
    const record = view.history.find(h => h.handNumber === frame.handNumber) ?? null;
    const playing = frame.phase === "playing" || frame.phase === "hand_over" || frame.phase === "game_over";
    if (frame.phase === "bidding") {
      return { dealer, main: bid ? (bid.amount === null ? "–" : bid.shoot ? "moon" : String(bid.amount)) : null, suit: null, total: null, small: null, rows: [] };
    }
    const team = teamOf(seat);
    const mates = frame.players.filter(p => teamOf(p.seat) === team);
    const rows: [string, string][] = mates.filter(p => p.meldPoints > 0 || meldOut).map(p => [`${seats[p.seat].name} meld`, String(p.meldPoints)]);
    if (playing) rows.push(["Counters", String(recap.counters[team])]);
    if (record) {
      const b = record.breakdown[team];
      if (b.meldDeclared > 0 && b.meldSaved === 0) rows.push(["Meld lost, no trick", `-${b.meldDeclared}`]);
      if (b.lastTrick) rows.push(["Last trick", String(b.lastTrick)]);
      if (b.setPenalty) rows.push(["Set", `-${b.setPenalty}`]);
      if (b.shoot) rows.push(["Shoot", String(b.shoot)]);
      rows.push(["This hand", `${record.delta[team] > 0 ? "+" : ""}${record.delta[team]}`]);
    } else rows.push(["So far", String(sideTotal(team))]);
    if (frame.bidder === seat && frame.highBid) {
      const total = record ? record.delta[team] : frame.phase === "melding" || playing ? sideTotal(team) : null;
      return { dealer, main: frame.highBid.shoot ? "moon" : String(frame.highBid.amount), suit: frame.trump, total, small: null, rows: [["Bid", frame.highBid.shoot ? "the moon" : String(frame.highBid.amount)], ...rows] };
    }
    if (frame.bidder !== null && teamOf(frame.bidder) === team) return { dealer, main: null, suit: null, total: null, small: null, rows: [] };
    const own = frame.players[seat].meldPoints;
    return { dealer, main: null, suit: null, total: null, small: frame.phase === "melding" || frame.phase === "playing" || record ? own : null, rows };
  };
  // A bidder holds 16 cards after the pass; fans tighten to stay inside the row.
  const sizes = phone ? { south: 44, north: 34, side: 30, budget: 340 } : { south: 60, north: 44, side: 38, budget: 680 };

  const chair = (seat: SeatIndex) => ({ seat, info: seats[seat], score: scoreOf(seat), mine: seat === viewerSeat, active: move.trick ? move.trick.winner === seat : move.actor === seat, cards: hand(seat), meld: meldOf(seat), lit, raised: raised(seat), prefs, atBottom: seat === bottom, onSit, flights });
  return (
    <div ref={root} className={`mx-auto w-full max-w-[760px] ${turn.className}`} data-motion={motion}
      style={{ ...turn.style, "--pm": `${slideMs}ms`, "--sd": `${holdMs}ms`, "--sm": `${sweepMs}ms` } as CSSProperties}>
      <SeatRow key={seatAt(2)} {...chair(seatAt(2))} width={sizes.north} budget={sizes.budget * 0.8} align="center" />
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
        <SeatRow key={seatAt(1)} {...chair(seatAt(1))} width={sizes.side} align="left" />
        <Centre frame={frame} trick={trick} rel={rel} nameOf={s => seats[s].name} compact={phone} flying={flying} sweep={animate && !!move.trick} />
        <SeatRow key={seatAt(3)} {...chair(seatAt(3))} width={sizes.side} align="right" />
      </div>
      <SeatRow key={seatAt(0)} {...chair(seatAt(0))} width={sizes.south} budget={sizes.budget} align="center" big />
    </div>
  );
}

function SeatRow({ seat, info, score, mine, active, cards, meld, lit, raised, prefs, width, align, big = false, budget = Infinity, atBottom, onSit, flights }: {
  seat: SeatIndex; info: SeatInfo; score: SeatScore; mine: boolean; active: boolean; cards: CardId[];
  /** cards lying on the table as meld, shown between the hand and the middle */
  meld: CardId[]; lit: Set<CardId>; raised: Set<CardId>;
  prefs: ReturnType<typeof useCardPrefs>["prefs"]; width: number; align: "left" | "center" | "right"; big?: boolean;
  atBottom: boolean; onSit: (seat: SeatIndex) => void; flights: Map<CardId, CSSProperties>;
  /** widest a horizontal fan may grow, in px */
  budget?: number;
}) {
  const team: Team = teamOf(seat);
  const vertical = align !== "center";
  const natural = vertical ? width * 0.55 : width * (big ? 0.58 : 0.52);
  const step = Math.round(vertical || cards.length < 2 ? natural : Math.min(natural, (budget - width) / (cards.length - 1)));
  const h = (width * 7) / 5;
  const items = align === "left" ? "items-start" : align === "right" ? "items-end" : "items-center";
  // Lifted cards move toward the middle of the table, whichever side they are on.
  const lift = big ? "translateY(-10px)" : "translateY(10px)";
  const meldW = Math.round(width * 0.8);
  const laid = meld.length > 0 && (
    <div className={`flex ${vertical ? "flex-col" : "flex-row"} items-center`} aria-label={`${info.name}'s meld: ${meld.length} cards`}
      style={vertical ? { padding: "0 4px" } : { paddingLeft: Math.round(meldW * 0.5) }}>
      {meld.map((c, i) => {
        const fly = flights.get(c);
        return vertical ? (
          <div key={c} className="relative shrink-0" style={{ width: (meldW * 7) / 5, height: i === meld.length - 1 ? meldW : Math.round(meldW * 0.6), zIndex: align === "right" ? meld.length - i : i }}>
            <div className={fly ? "trick-card absolute inset-0" : "absolute inset-0"} style={fly}>
              <PlayingCard card={c} width={meldW} prefs={prefs} selected={lit.has(c)}
                style={{ position: "absolute", left: "50%", top: meldW / 2, transform: `translate(-50%, -50%) rotate(${align === "left" ? 90 : -90}deg)` }} />
            </div>
          </div>
        ) : (
          <span key={c} className={`shrink-0 ${fly ? "trick-card" : ""}`} style={{ marginLeft: -Math.round(meldW * 0.5), ...fly }}>
            <PlayingCard card={c} width={meldW} prefs={prefs} selected={lit.has(c)} />
          </span>
        );
      })}
    </div>
  );
  return (
    <div className={`relative z-[1] flex min-w-0 flex-col ${items} gap-1 ${big ? "mt-3" : "py-1"}`}>
      {big && laid}
      <div className={`flex max-w-full items-center gap-1 ${vertical ? "flex-col" : "flex-row"}`}>
        <button type="button" data-chip="" onClick={() => { if (!atBottom) onSit(seat); }} aria-pressed={atBottom}
          aria-label={`${atBottom ? `${info.name}, at the bottom of the table` : `See the table from ${info.name}'s seat`}${mine ? " (you)" : ""}${score.dealer ? ", dealer" : ""}`}
          title={atBottom ? undefined : `See it from ${info.name}'s seat`}
          className={`flex max-w-full items-center gap-1.5 rounded-2xl px-2 py-1 text-left transition-colors ${vertical ? "flex-col" : "flex-row"} ${atBottom ? "cursor-default" : "hover:bg-chalk-ghost focus-visible:bg-chalk-ghost"}`}
          style={active ? { boxShadow: "0 0 0 2px var(--brass)" } : undefined}>
          <span className="relative">
            <Avatar name={info.name} team={team} size={26} bot={info.bot} />
            {score.dealer && <span aria-hidden title="Dealer" className="absolute -bottom-1 -right-1 flex size-3.5 items-center justify-center rounded-full bg-chalk text-[9px] font-bold leading-none text-ink">D</span>}
          </span>
          <span className={`truncate text-xs font-semibold ${vertical ? "max-w-[72px]" : "max-w-[140px]"} ${mine ? "text-brass" : ""}`} title={mine ? "You" : undefined}>{info.name}</span>
        </button>
        <ScoreTag score={score} name={info.name} align={align} />
      </div>
      {cards.length === 0 ? (
        <span className="text-xs text-chalk-faint" style={{ minHeight: vertical ? undefined : h + 8 }}>{big || !vertical ? "No cards left" : ""}</span>
      ) : vertical ? (
        <div className={`flex items-start ${align === "right" ? "flex-row-reverse" : "flex-row"}`}>
        <div className="flex flex-col" style={{ padding: "0 6px" }} aria-label={`${info.name}: ${cards.length} cards`}>
          {cards.map((c, i) => {
            const up = raised.has(c);
            const fly = flights.get(c);
            return (
              <div key={c} className="relative shrink-0" style={{ width: h, height: i === cards.length - 1 ? width : step, zIndex: align === "right" ? cards.length - i : i }}>
                <div className={fly ? "trick-card absolute inset-0" : "absolute inset-0"} style={fly}>
                  <PlayingCard card={c} width={width} prefs={prefs} selected={up}
                    style={{ position: "absolute", left: "50%", top: width / 2, transform: `translate(-50%, -50%) rotate(${align === "left" ? 90 : -90}deg) ${up ? "translateY(-8px)" : ""}` }} />
                </div>
              </div>
            );
          })}
        </div>
        {laid}
        </div>
      ) : (
        <div className="flex items-end" style={{ paddingTop: 10, paddingLeft: width - step }} aria-label={`${info.name}: ${cards.length} cards`}>
          {cards.map((c) => {
            const up = raised.has(c);
            const fly = flights.get(c);
            return (
              <span key={c} className={`shrink-0 ${fly ? "trick-card" : ""}`} style={{ marginLeft: step - width, ...fly }}>
                <span className="block" style={{ transform: up ? lift : undefined, transition: "transform .14s ease" }}>
                  <PlayingCard card={c} width={width} prefs={prefs} selected={up} />
                </span>
              </span>
            );
          })}
        </div>
      )}
      {!big && !vertical && laid}
    </div>
  );
}

const SUIT_INK: Record<Suit, string> = { S: "var(--chalk)", C: "var(--chalk)", H: "var(--deck-red-soft)", D: "var(--deck-red-soft)" };

/** The numbers beside a name. Tapping them opens the breakdown; Escape or a tap elsewhere closes it. */
function ScoreTag({ score, name, align }: { score: SeatScore; name: string; align: "left" | "center" | "right" }) {
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

function Centre({ frame, trick, rel, nameOf, compact, flying, sweep }: {
  frame: GameState; trick: Trick | null; rel: (s: SeatIndex) => 0 | 1 | 2 | 3; nameOf: (s: SeatIndex) => string; compact: boolean;
  /** the card played this move, which slides in from its seat */
  flying: CardId | null;
  /** the move completed the trick: it rests, then sweeps to the winner */
  sweep: boolean;
}) {
  const w = compact ? 46 : 60;
  const spots: Record<0 | 1 | 2 | 3, string> = {
    0: "bottom-0 left-1/2 -translate-x-1/2", 1: "left-0 top-1/2 -translate-y-1/2", 2: "top-0 left-1/2 -translate-x-1/2", 3: "right-0 top-1/2 -translate-y-1/2",
  };
  const done = !!trick && trick.plays.length === 4 && trick.winner !== null;

  return (
    <div className="mx-auto w-full max-w-[300px]">
      <div className="relative mx-auto w-full" style={{ height: compact ? 2 * w * 1.4 + 12 : 2 * w * 1.4 + 24, maxWidth: compact ? 220 : 280 }}>
        <div className="absolute inset-x-[2%] inset-y-[8%] rounded-[46%] border-[5px] border-cloth-edge"
          style={{ background: "radial-gradient(ellipse at 50% 40%, #6b2530, var(--cloth-deep))", boxShadow: "inset 0 10px 30px rgba(0,0,0,.35)" }} />
        {frame.trump && (
          <span aria-hidden className="pointer-events-none absolute inset-0 flex select-none items-center justify-center leading-none"
            style={{ fontSize: compact ? 72 : 110, color: "#fff", opacity: 0.07 }}>{SUIT_GLYPH[frame.trump]}</span>
        )}
        {trick?.plays.map((p) => {
          const sweeping = sweep && done;
          const moving = p.card === flying || sweeping;
          // Cards already on the table start where they lie; only the card just played flies in.
          const start = p.card === flying ? flyFrom(rel(p.seat), p.card) : { "--fx": "0px", "--fy": "0px", "--fr": "0deg", "--fs": 1 };
          return (
            <div key={p.card} className={`absolute ${spots[rel(p.seat)]}`}>
              <div className={moving ? "trick-card" : undefined} data-sweep={sweeping ? "" : undefined}
                style={moving ? { ...start, ...(sweeping ? sweepTo(rel(trick.winner!)) : null) } as CSSProperties : undefined}>
                <PlayingCard card={p.card} width={w} selected={done && trick.winner === p.seat} />
              </div>
            </div>
          );
        })}
        {!trick?.plays.length && frame.phase !== "bidding" && frame.phase !== "declaring_trump" && (
          <p className="absolute inset-0 flex items-center justify-center text-center text-xs text-chalk-faint">
            {frame.phase === "melding" ? "Meld" : frame.phase === "hand_over" || frame.phase === "game_over" ? "Hand over" : frame.phase === "playing" ? "" : "Passing"}
          </p>
        )}
      </div>
      <div className="mt-1 min-h-4 text-center text-xs text-chalk-faint">
        {done && <p>{nameOf(trick.winner!)} took it.</p>}
        {(frame.phase === "playing" || frame.phase === "hand_over") && (
          <p className="tabular-nums">Tricks <span className="text-deck-red-soft">{frame.tricksTaken.red.length}</span> · <span className="text-deck-blue-soft">{frame.tricksTaken.blue.length}</span></p>
        )}
      </div>
    </div>
  );
}
