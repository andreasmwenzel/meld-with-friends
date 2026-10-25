"use client";

import type { CardId, GameState, SeatIndex, Team, Trick } from "@/engine/types";
import { sortHand } from "@/engine/hand";
import { PlayingCard, SUIT_GLYPH } from "@/components/cards/PlayingCard";
import { Avatar } from "@/components/site/Avatar";
import { useCardPrefs } from "@/lib/cardPrefs";
import { teamOf } from "@/components/table/types";
import { useEffect, useRef } from "react";
import { useTableTurn } from "@/components/table/turn";
import type { Move } from "./model";

interface SeatInfo { name: string; bot: boolean }

/**
 * The table with every hand face up, as it stood after one move. The reader's seat sits at the
 * bottom; the seat that moved wears the turn ring, and the cards the move touched are lifted.
 */
export function ReplayBoard({ frame, move, bottom, seats, viewerSeat, onSit }: {
  frame: GameState; move: Move; bottom: SeatIndex; seats: Record<SeatIndex, SeatInfo>;
  /** the reader's own seat in this game, if they played */
  viewerSeat: SeatIndex | null;
  /** tap a player to bring their chair to the bottom */
  onSit: (seat: SeatIndex) => void;
}) {
  const { prefs, phone } = useCardPrefs();
  const turn = useTableTurn(bottom);
  // The chips change places when the table turns; keyboard focus follows the chair the reader chose.
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!root.current?.contains(document.activeElement) || !document.activeElement?.closest("[data-chip]")) return;
    root.current.querySelector<HTMLElement>('[data-chip][aria-pressed="true"]')?.focus();
  }, [bottom]);
  const seatAt = (r: number): SeatIndex => (((bottom + r) % 4) as SeatIndex);
  const rel = (seat: SeatIndex): 0 | 1 | 2 | 3 => (((seat - bottom + 4) % 4) as 0 | 1 | 2 | 3);
  const lit = new Set(move.cards);
  const melding = frame.phase === "melding";
  const hand = (seat: SeatIndex) => sortHand(frame.players[seat].hand, frame.trump, prefs.sort);
  // Lit cards lift wherever they now sit: a pass lights up in the hand that received it.
  const raised = (seat: SeatIndex): Set<CardId> => {
    const cards = new Set<CardId>(frame.players[seat].hand.filter(c => lit.has(c)));
    if (melding) for (const item of frame.players[seat].meld) for (const c of item.cards) cards.add(c);
    return cards;
  };
  const trick: Trick | null = frame.currentTrick?.plays.length ? frame.currentTrick : move.trick;
  const status = (seat: SeatIndex): string | null => {
    const bid = frame.bids.filter(b => b.seat === seat).at(-1);
    const parts: string[] = [];
    if (seat === viewerSeat) parts.push("you");
    if (frame.dealer === seat) parts.push("dealer");
    if (frame.phase === "bidding" && bid) parts.push(bid.amount === null ? "passed" : bid.shoot ? "shoots" : `bid ${bid.amount}`);
    if (frame.phase !== "bidding" && frame.bidder === seat) parts.push(frame.highBid?.shoot ? "shooting" : `took it at ${frame.highBid?.amount}`);
    if ((melding || frame.phase === "playing") && frame.players[seat].meldPoints > 0) parts.push(`meld ${frame.players[seat].meldPoints}`);
    return parts.length ? parts.join(", ") : null;
  };
  // A bidder holds 16 cards after the pass; fans tighten to stay inside the row.
  const sizes = phone ? { south: 44, north: 34, side: 30, budget: 340 } : { south: 60, north: 44, side: 38, budget: 680 };

  const chair = (seat: SeatIndex) => ({ seat, info: seats[seat], status: status(seat), active: move.actor === seat, cards: hand(seat), raised: raised(seat), prefs, atBottom: seat === bottom, onSit });
  return (
    <div ref={root} className={`mx-auto w-full max-w-[760px] ${turn.className}`} style={turn.style}>
      <SeatRow {...chair(seatAt(2))} width={sizes.north} budget={sizes.budget * 0.8} align="center" />
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
        <SeatRow {...chair(seatAt(1))} width={sizes.side} align="left" />
        <Centre frame={frame} trick={trick} rel={rel} nameOf={s => seats[s].name} compact={phone} />
        <SeatRow {...chair(seatAt(3))} width={sizes.side} align="right" />
      </div>
      <SeatRow {...chair(seatAt(0))} width={sizes.south} budget={sizes.budget} align="center" big />
    </div>
  );
}

function SeatRow({ seat, info, status, active, cards, raised, prefs, width, align, big = false, budget = Infinity, atBottom, onSit }: {
  seat: SeatIndex; info: SeatInfo; status: string | null; active: boolean; cards: CardId[]; raised: Set<CardId>;
  prefs: ReturnType<typeof useCardPrefs>["prefs"]; width: number; align: "left" | "center" | "right"; big?: boolean;
  atBottom: boolean; onSit: (seat: SeatIndex) => void;
  /** widest a horizontal fan may grow, in px */
  budget?: number;
}) {
  const team: Team = teamOf(seat);
  const vertical = align !== "center";
  const natural = vertical ? width * 0.55 : width * (big ? 0.58 : 0.52);
  const step = Math.round(vertical || cards.length < 2 ? natural : Math.min(natural, (budget - width) / (cards.length - 1)));
  const h = (width * 7) / 5;
  const items = align === "left" ? "items-start" : align === "right" ? "items-end" : "items-center";
  return (
    <div className={`flex min-w-0 flex-col ${items} gap-1 ${big ? "mt-3" : "py-1"}`}>
      <button type="button" data-chip="" onClick={() => { if (!atBottom) onSit(seat); }} aria-pressed={atBottom}
        aria-label={atBottom ? `${info.name}, at the bottom of the table` : `See the table from ${info.name}'s seat`}
        title={atBottom ? undefined : `See it from ${info.name}'s seat`}
        className={`flex max-w-full items-center gap-1.5 rounded-2xl px-2 py-1 text-left transition-colors ${vertical ? "flex-col" : "flex-row"} ${atBottom ? "cursor-default" : "hover:bg-chalk-ghost focus-visible:bg-chalk-ghost"}`}
        style={active ? { boxShadow: "0 0 0 2px var(--brass)" } : undefined}>
        <Avatar name={info.name} team={team} size={26} bot={info.bot} />
        <span className={`truncate text-xs font-semibold ${vertical ? "max-w-[72px]" : "max-w-[140px]"}`}>{info.name}</span>
        {status && <span className={`text-xs text-chalk-faint ${vertical ? "max-w-[72px] text-center" : "whitespace-nowrap"}`}>{status}</span>}
      </button>
      {cards.length === 0 ? (
        <span className="text-xs text-chalk-faint" style={{ minHeight: vertical ? undefined : h + 8 }}>{big || !vertical ? "No cards left" : ""}</span>
      ) : vertical ? (
        <div className="flex flex-col" style={{ padding: "0 6px" }} aria-label={`${info.name}: ${cards.length} cards`}>
          {cards.map((c, i) => {
            const up = raised.has(c);
            return (
              <div key={c} className="relative shrink-0" style={{ width: h, height: i === cards.length - 1 ? width : step, zIndex: align === "right" ? cards.length - i : i }}>
                <PlayingCard card={c} width={width} prefs={prefs} selected={up}
                  style={{ position: "absolute", left: "50%", top: width / 2, transform: `translate(-50%, -50%) rotate(${align === "left" ? 90 : -90}deg) ${up ? `translateY(${align === "left" ? "-8px" : "8px"})` : ""}` }} />
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex items-end" style={{ paddingTop: 10, paddingLeft: width - step }} aria-label={`${info.name}: ${cards.length} cards`}>
          {cards.map((c) => {
            const up = raised.has(c);
            return (
              <span key={c} className="shrink-0" style={{ marginLeft: step - width, transform: up ? "translateY(-10px)" : undefined, transition: "transform .14s ease" }}>
                <PlayingCard card={c} width={width} prefs={prefs} selected={up} />
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Centre({ frame, trick, rel, nameOf, compact }: {
  frame: GameState; trick: Trick | null; rel: (s: SeatIndex) => 0 | 1 | 2 | 3; nameOf: (s: SeatIndex) => string; compact: boolean;
}) {
  const w = compact ? 46 : 60;
  const spots: Record<0 | 1 | 2 | 3, string> = {
    0: "bottom-0 left-1/2 -translate-x-1/2", 1: "left-0 top-1/2 -translate-y-1/2", 2: "top-0 left-1/2 -translate-x-1/2", 3: "right-0 top-1/2 -translate-y-1/2",
  };
  const done = !!trick && trick.plays.length === 4 && trick.winner !== null;
  const red = frame.trump === "H" || frame.trump === "D";
  const line = (() => {
    if (frame.highBid && frame.bidder !== null) {
      return <>{nameOf(frame.bidder)} {frame.highBid.shoot ? "is shooting the moon" : `took it at ${frame.highBid.amount}`}{frame.trump && <> in <span className={red ? "text-deck-red-soft" : "text-chalk"}>{SUIT_GLYPH[frame.trump]}</span></>}</>;
    }
    if (frame.highBid) return <>{nameOf(frame.highBid.seat)} holds {frame.highBid.shoot ? "the moon" : frame.highBid.amount}</>;
    return <>Bidding</>;
  })();
  return (
    <div className="mx-auto w-full max-w-[300px]">
      <div className="relative mx-auto w-full" style={{ height: compact ? 2 * w * 1.4 + 12 : 2 * w * 1.4 + 24, maxWidth: compact ? 220 : 280 }}>
        <div className="absolute inset-x-[2%] inset-y-[8%] rounded-[46%] border-[5px] border-cloth-edge"
          style={{ background: "radial-gradient(ellipse at 50% 40%, #6b2530, var(--cloth-deep))", boxShadow: "inset 0 10px 30px rgba(0,0,0,.35)" }} />
        {frame.trump && (
          <span aria-hidden className="pointer-events-none absolute inset-0 flex select-none items-center justify-center leading-none"
            style={{ fontSize: compact ? 72 : 110, color: "#fff", opacity: 0.07 }}>{SUIT_GLYPH[frame.trump]}</span>
        )}
        {trick?.plays.map((p) => (
          <div key={p.card} className={`absolute ${spots[rel(p.seat)]}`}>
            <PlayingCard card={p.card} width={w} selected={done && trick.winner === p.seat} />
          </div>
        ))}
        {!trick?.plays.length && frame.phase !== "bidding" && frame.phase !== "declaring_trump" && (
          <p className="absolute inset-0 flex items-center justify-center text-center text-xs text-chalk-faint">
            {frame.phase === "melding" ? "Meld" : frame.phase === "hand_over" || frame.phase === "game_over" ? "Hand over" : frame.phase === "playing" ? "" : "Passing"}
          </p>
        )}
      </div>
      <div className="mt-1 text-center text-xs text-chalk-faint">
        <p>{line}</p>
        {done && <p>{nameOf(trick.winner!)} took it.</p>}
        {(frame.phase === "playing" || frame.phase === "hand_over") && (
          <p className="tabular-nums">Tricks <span className="text-deck-red-soft">{frame.tricksTaken.red.length}</span> to <span className="text-deck-blue-soft">{frame.tricksTaken.blue.length}</span></p>
        )}
      </div>
    </div>
  );
}
