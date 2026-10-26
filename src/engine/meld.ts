import { SUITS } from './deck';
import { DEFAULT_RULES, type RulesConfig } from './types';
import { scoringFactor } from './scoring';
import type { CardId, MeldItem, MeldKind, Rank, Suit } from './types';

export const MELD_POINTS: Readonly<Record<MeldKind, number>> = {
  run: 150, double_run: 1500, royal_marriage: 40, marriage: 20, dix: 10,
  pinochle: 40, double_pinochle: 300,
  aces_around: 100, kings_around: 80, queens_around: 60, jacks_around: 40,
  double_aces_around: 1000, double_kings_around: 800,
  double_queens_around: 600, double_jacks_around: 400,
};

export function computeMeld(cards: CardId[], trump: Suit, rules: Pick<RulesConfig, 'scoring'> = DEFAULT_RULES): { items: MeldItem[]; total: number } {
  const unique = [...new Set(cards)];
  const matching = (rank: Rank, suit: Suit) => unique.filter(c => c[0] === rank && c[1] === suit).sort();
  const items: MeldItem[] = [];
  const add = (kind: MeldKind, used: CardId[]) => items.push({ kind, cards: used, points: MELD_POINTS[kind] * scoringFactor(rules) });
  const runRanks: Rank[] = ['A', 'T', 'K', 'Q', 'J'];
  const runs = Math.min(...runRanks.map(rank => matching(rank, trump).length));
  const runCards = runRanks.flatMap(rank => matching(rank, trump).slice(0, runs));
  if (runs) add(runs === 2 ? 'double_run' : 'run', runCards);
  // Runs beat every conflicting marriage combination. The remaining K/Q pairs
  // are independent; arounds and pinochles each have their own card-use class.
  for (const suit of SUITS) {
    const kings = matching('K', suit).filter(c => !runCards.includes(c));
    const queens = matching('Q', suit).filter(c => !runCards.includes(c));
    for (let i = 0; i < Math.min(kings.length, queens.length); i++) {
      add(suit === trump ? 'royal_marriage' : 'marriage', [kings[i], queens[i]]);
    }
  }
  const arounds = [
    ['A', 'aces_around', 'double_aces_around'],
    ['K', 'kings_around', 'double_kings_around'],
    ['Q', 'queens_around', 'double_queens_around'],
    ['J', 'jacks_around', 'double_jacks_around'],
  ] as const;
  for (const [rank, single, double] of arounds) {
    const count = Math.min(...SUITS.map(suit => matching(rank, suit).length));
    if (count) add(count === 2 ? double : single, SUITS.flatMap(suit => matching(rank, suit).slice(0, count)));
  }
  const qs = matching('Q', 'S');
  const jd = matching('J', 'D');
  const count = Math.min(qs.length, jd.length);
  if (count) add(count === 2 ? 'double_pinochle' : 'pinochle', [...qs.slice(0, count), ...jd.slice(0, count)]);
  for (const card of matching('9', trump)) add('dix', [card]);
  return { items, total: items.reduce((sum, item) => sum + item.points, 0) };
}

/** Five or more nines and nothing else to meld whatever trump turns out to be: the hand may be thrown in. */
export function qualifiesForMisdeal(hand: CardId[]): boolean {
  if (hand.filter(card => card[0] === '9').length < 5) return false;
  return SUITS.every(trump => computeMeld(hand, trump).items.every(item => item.kind === 'dix'));
}
