import type { CardId, PlayerView, SeatIndex, Suit } from '../types';
import { ranks, seats, suits, suitOf } from './shared';

export function knowledge(view: PlayerView) {
  const gone = new Set(view.playedCards.map(p => p.card));
  const voids = seats.map(() => new Set<Suit>());
  for (let i = 0; i < view.playedCards.length; i += 4) {
    const trick = view.playedCards.slice(i, i + 4);
    const led = suitOf(trick[0].card);
    for (const play of trick.slice(1)) if (suitOf(play.card) !== led) {
      voids[play.seat].add(led);
      if (view.trump && suitOf(play.card) !== view.trump) voids[play.seat].add(view.trump);
    }
  }
  const known = seats.map(seat => seat === view.seat ? [...view.hand] : [...new Set(view.melds[seat].flatMap(m => m.cards))].filter(c => !gone.has(c)));
  const deck = suits.flatMap(s => [...ranks].flatMap(r => [0, 1].map(c => `${r}${s}${c}` as CardId)));
  const unknown = deck.filter(c => !gone.has(c) && !known.some(hand => hand.includes(c)));
  const estimates = seats.map(seat => ({ seat, count: view.handCounts[seat], known: known[seat], bid: view.bids.filter(b => b.seat === seat && b.amount !== null).at(-1)?.amount ?? null,
    suits: Object.fromEntries(suits.map(s => [s, voids[seat].has(s) ? 0 : unknown.filter(c => suitOf(c) === s).length / Math.max(1, seats.filter(x => x !== view.seat && !voids[x].has(s)).length)])) }));
  return { gone, voids, known, unknown, estimates };
}

/** Randomized constrained assignment. Backtracking preserves counts, meld ownership and voids. */
export function sampleDeal(view: PlayerView, rng: () => number): CardId[][] | null {
  const k = knowledge(view);
  const hands = k.known.map(h => [...h]);
  const capacity = seats.map(s => view.handCounts[s] - hands[s].length);
  const pool = k.unknown.map(card => ({ card, tie: rng() })).sort((a, b) => {
    const eligible = (c: CardId) => seats.filter(s => s !== view.seat && !k.voids[s].has(suitOf(c))).length;
    return eligible(a.card) - eligible(b.card) || a.tie - b.tie;
  });
  let nodes = 0;
  function assign(i: number): boolean {
    if (++nodes > 3000) return false;
    if (i === pool.length) return capacity.every(n => n === 0);
    const card = pool[i].card;
    const candidates = seats.filter(s => s !== view.seat && capacity[s] > 0 && !k.voids[s].has(suitOf(card))).map(s => ({ s, tie: rng() })).sort((a,b) => a.tie-b.tie);
    for (const { s } of candidates) {
      hands[s].push(card); capacity[s]--;
      if (assign(i + 1)) return true;
      hands[s].pop(); capacity[s]++;
    }
    return false;
  }
  return capacity.some(n => n < 0) || !assign(0) ? null : hands;
}
export type Knowledge = ReturnType<typeof knowledge>;
export type { SeatIndex };
