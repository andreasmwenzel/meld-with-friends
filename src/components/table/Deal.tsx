"use client";

import { useEffect, useLayoutEffect, useState, type RefObject } from "react";
import type { MotionPref } from "@/lib/cardPrefs";
import type { PlayerView, SeatIndex, Team } from "@/engine/types";
import { CardBack } from "@/components/cards/PlayingCard";
import { teamOf } from "./types";
import { dealLandsAt, dealLaunch, dealTimings } from "./motion";

/** The last deal this tab has shown at each table, so a reload, a remount or a visit to another table does not deal the
 *  same cards again. */
const seenKey = (code: string) => `meld.dealt.${code}`;

export type Deal = {
  dealer: SeatIndex;
  /** each seat's cards, in the order they were dealt (yours by card, the others by count) */
  hand: PlayerView["hand"]; counts: PlayerView["handCounts"];
  /** when a seat's `i`th dealt card lands, in ms from the start of the deal */
  landAt: (seat: SeatIndex, i: number) => number;
  launchAt: (seat: SeatIndex, i: number) => number;
  flyMs: number; turnMs: number;
  /** the last card down */
  total: number;
};

/**
 * A new hand is dealt on the table: from a deck in front of the dealer, round from their left, three cards at a time.
 * Plays once per hand in this tab, on a fresh deal (bidding, nobody has bid), and not at all with motion off.
 */
export function useDeal(view: PlayerView | null, motion: MotionPref, code: string): Deal | null {
  const key = view && view.phase === "bidding" && view.bids.length === 0 ? `${view.handNumber}|${view.hand.join()}` : null;
  const [deal, setDeal] = useState<Deal | null>(null);
  // Before paint, so the hand never shows whole and then empties to be dealt.
  useLayoutEffect(() => {
    const t = dealTimings(motion);
    // Motion turned off (or reduced motion turned on) mid-deal: the cards are all down at once.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- ends a deal the motion setting no longer allows
    if (!t) setDeal(null);
    if (!key || !view) return;
    try {
      if (sessionStorage.getItem(seenKey(code)) === key) return;
      sessionStorage.setItem(seenKey(code), key);
    } catch { return; }
    if (!t) return;
    const dealer = view.dealer;
    const q = (seat: SeatIndex) => (seat - dealer + 3) % 4;
    const landAt = (seat: SeatIndex, i: number) => dealLandsAt(t, q(seat), i);
    const last = Math.max(...([0, 1, 2, 3] as const).map((s) => landAt(s, Math.max(0, view.handCounts[s] - 1))));
    setDeal({ dealer, hand: view.hand, counts: view.handCounts, landAt, launchAt: (seat, i) => dealLaunch(t, q(seat), i),
      flyMs: t.flyMs, turnMs: t.turnMs, total: last + t.turnMs });
  }, [key, motion, view, code]);
  useEffect(() => {
    if (!deal) return;
    const timer = setTimeout(() => setDeal(null), deal.total + 50);
    return () => clearTimeout(timer);
  }, [deal]);
  return deal;
}

type Flight = { id: string; x: number; y: number; w: number; fx: number; fy: number; s0: number; r0: number; r1: number; at: number; team: Team;
  /** a sideways phone shows a seat's hand as a count: the card fades into the name instead */
  chip: boolean };

const SIDE = { 1: "west", 2: "north", 3: "east" } as const;

/**
 * The cards in flight, over the whole board. Waiting cards make the deck: stacked a little off the cloth's middle, toward
 * the dealer, the next card out on top. Each flies to the place it will lie in its hand (a side seat's turning as it goes),
 * and the hand shows it from the moment it lands (Game: `deal-show`, `deal-turn`).
 */
export function DealLayer({ deal, root, mySeat }: { deal: Deal; root: RefObject<HTMLElement | null>; mySeat: SeatIndex }) {
  const [flights, setFlights] = useState<Flight[]>([]);
  // Measured before the first paint and then every frame until the last card is down: the board can still be settling
  // (its scale, or gliding to the middle as the result sheet's room goes), and a card in flight should end where its
  // hand now lies. Running animations take up the new positions.
  useLayoutEffect(() => {
    let frame = 0;
    const until = performance.now() + deal.total;
    const measure = () => {
      const next = flightsFor(root.current, deal, mySeat);
      if (next) setFlights((prev) => same(prev, next) ? prev : next);
      if (performance.now() < until) frame = requestAnimationFrame(measure);
    };
    measure();
    return () => cancelAnimationFrame(frame);
  }, [deal, root, mySeat]);
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-20 overflow-hidden" style={{ "--df": `${deal.flyMs}ms` } as React.CSSProperties}>
      {flights.map((c) => (
        <span key={c.id} className="deal-fly absolute block" style={{
          left: c.x - c.w / 2, top: c.y - (c.w * 7) / 10,
          "--fx": `${c.fx}px`, "--fy": `${c.fy}px`, "--s0": c.s0, "--r0": `${c.r0}deg`, "--r1": `${c.r1}deg`, "--dd": `${c.at}ms`, "--o1": c.chip ? 0 : 1,
        } as React.CSSProperties}>
          <CardBack width={c.w} team={c.team} />
        </span>
      ))}
    </div>
  );
}

const same = (a: Flight[], b: Flight[]) => a.length === b.length && a.every((f, i) => f.id === b[i].id
  && [f.x - b[i].x, f.y - b[i].y, f.w - b[i].w, f.fx - b[i].fx, f.fy - b[i].fy].every((d) => Math.abs(d) < 0.5));

function flightsFor(el: HTMLElement | null, deal: Deal, mySeat: SeatIndex): Flight[] | null {
  const felt = el?.querySelector("[data-felt]");
  if (!el || !felt) return null;
  const box = el.getBoundingClientRect(), f = felt.getBoundingClientRect();
  const rel = (seat: SeatIndex) => ((seat - mySeat + 4) % 4) as 0 | 1 | 2 | 3;
  const [dx, dy] = ([[0, 1], [-1, 0], [0, -1], [1, 0]] as const)[rel(deal.dealer)];
  const ox = f.left + f.width / 2 + dx * f.width * 0.22 - box.left, oy = f.top + f.height / 2 + dy * f.height * 0.2 - box.top;
  const deckW = Math.max(24, Math.round(f.width * 0.12));
  const out: Flight[] = [];
  for (const seat of [0, 1, 2, 3] as const) {
    const r = rel(seat), n = deal.counts[seat];
    const fan = r === 0 ? null : el.querySelector(`[data-hand="${SIDE[r]}"]`);
    const chip = el.querySelector(`[data-claim-seat="${seat}"]`);
    for (let i = 0; i < n; i++) {
      // Your card goes to its own place in your hand; another seat's to the next back in its fan, or to its name.
      const target = r === 0 ? el.querySelector(`[data-hand-card="${deal.hand[i]}"]`) : fan && fan.children.length >= n ? fan.children[i] : null;
      const rect = (target ?? chip)?.getBoundingClientRect();
      if (!rect) continue;
      const turned = !!target && (r === 1 || r === 3);
      // Your cards are turning face up as they land, edge on until then, so take their width from the layout.
      const w = !target ? 18 : r === 0 ? (target as HTMLElement).offsetWidth : turned ? rect.height : rect.width;
      const x = rect.left + rect.width / 2 - box.left, y = rect.top + rect.height / 2 - box.top;
      const order = (i * 4 + ((seat - deal.dealer + 3) % 4));
      out.push({
        id: `${seat}-${i}`, x, y, w, team: teamOf(seat), at: deal.launchAt(seat, i), chip: !target,
        // The deck stands a little higher for every card still in it.
        fx: ox - x, fy: oy - y - (48 - order) * 0.25, s0: deckW / w,
        r0: ((order * 7) % 9 - 4) * 2, r1: !target ? 0 : r === 1 ? 90 : r === 3 ? -90 : 0,
      });
    }
  }
  // The next card out lies on top of the deck.
  return out.sort((a, b) => b.at - a.at);
}
