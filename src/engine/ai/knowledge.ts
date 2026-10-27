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
  // Cards this seat passed went to its partner, who still holds any not played or passed back.
  const passedToPartner = (seat: SeatIndex) => seat === (view.seat + 2) % 4 ? view.recap.myPassedOut.filter(c => !view.hand.includes(c)) : [];
  const known = seats.map(seat => seat === view.seat ? [...view.hand] : [...new Set([...view.melds[seat].flatMap(m => m.cards), ...passedToPartner(seat)])].filter(c => !gone.has(c)));
  const deck = suits.flatMap(s => [...ranks].flatMap(r => [0, 1].map(c => `${r}${s}${c}` as CardId)));
  const unknown = deck.filter(c => !gone.has(c) && !known.some(hand => hand.includes(c)));
  const estimates = seats.map(seat => ({ seat, count: view.handCounts[seat], known: known[seat], bid: view.bids.filter(b => b.seat === seat && b.amount !== null).at(-1)?.amount ?? null,
    suits: Object.fromEntries(suits.map(s => [s, voids[seat].has(s) ? 0 : unknown.filter(c => suitOf(c) === s).length / Math.max(1, seats.filter(x => x !== view.seat && !voids[x].has(s)).length)])) }));
  return { gone, voids, known, unknown, estimates };
}

/**
 * How strong a seat's public calls say its hand is: -0.5 for a pass without a bid, 0 before it
 * has called, and 0.4 to 1 for a bid, rising with how far above the minimum it went.
 */
export function bidStrength(view: PlayerView, seat: SeatIndex) {
  const calls = view.bids.filter(b => b.seat === seat);
  const bids = calls.filter(b => b.amount !== null);
  if (!bids.length) return calls.length ? -.5 : 0;
  if (bids.some(b => b.shoot)) return 1;
  const top = Math.max(...bids.map(b => b.amount!));
  return Math.min(1, .4 + .6 * (top - view.rules.minBid) / (10 * view.rules.bidStep));
}

/**
 * Relative odds that a hidden card sits with a seat, from the auction: bidders hold more aces and
 * trump, passers fewer; the declarer chose trump and was passed more of it, so its partner holds less.
 */
export function cardWeights(view: PlayerView) {
  const strength = seats.map(seat => bidStrength(view, seat));
  const passing = view.rules.passCount > 0;
  return (seat: SeatIndex, card: CardId) => {
    let log = 0;
    if (card[0] === 'A') log += .6 * strength[seat];
    if (view.trump && suitOf(card) === view.trump) {
      log += .4 * strength[seat];
      if (seat === view.bidder) log += passing ? .8 : .5;
      else if (passing && view.bidder !== null && seat === (view.bidder + 2) % 4) log -= .4;
    }
    return Math.exp(log);
  };
}

/** Randomized constrained assignment. Backtracking preserves counts, meld ownership and voids; the auction weights the order seats are tried. */
export function sampleDeal(view: PlayerView, rng: () => number): CardId[][] | null {
  const k = knowledge(view);
  const weight = cardWeights(view);
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
    // Weighted order without replacement: the first seat tried is drawn in proportion to its weight.
    const candidates = seats.filter(s => s !== view.seat && capacity[s] > 0 && !k.voids[s].has(suitOf(card))).map(s => ({ s, tie: Math.log(rng() || Number.MIN_VALUE) / weight(s, card) })).sort((a,b) => b.tie-a.tie);
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
