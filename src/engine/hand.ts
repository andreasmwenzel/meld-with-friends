import { parseCard, RANK_ORDER } from './deck';
import { computeMeld } from './meld';
import { DEFAULT_RULES } from './types';
import type { CardId, MeldItem, Suit, RulesConfig } from './types';

/** How the suits other than trump are laid out: always spades, hearts, clubs, diamonds, or rearranged so colours alternate around trump. */
export type SuitOrder = 'fixed' | 'alternating';
/** Where trump sits once it is named: first, last, or in its usual place among the suits. */
export type TrumpPlacement = 'left' | 'right' | 'off';
export type RankDirection = 'high-first' | 'low-first';

export interface HandSortPrefs {
  suits: SuitOrder;
  trump: TrumpPlacement;
  ranks: RankDirection;
}

export const DEFAULT_HAND_SORT: HandSortPrefs = { suits: 'fixed', trump: 'left', ranks: 'high-first' };

const SUIT_ORDER: readonly Suit[] = ['S', 'H', 'C', 'D'];
/** Trump first, then the other suits alternating colour. S H C D already alternates. */
const ALTERNATING_SUITS: Record<Suit, readonly Suit[]> = {
  S: ['S', 'H', 'C', 'D'],
  H: ['H', 'S', 'D', 'C'],
  C: ['C', 'H', 'S', 'D'],
  D: ['D', 'S', 'H', 'C'],
};

/**
 * Suits left to right. Off (or no trump yet) is always S H C D. Left puts trump first and the
 * rest after it, either in S H C D order or alternating colour; Right is the same with trump
 * moved from the front to the end.
 */
export function suitSequence(trump: Suit | null, prefs: Pick<HandSortPrefs, 'suits' | 'trump'> = DEFAULT_HAND_SORT): Suit[] {
  if (!trump || prefs.trump === 'off') return [...SUIT_ORDER];
  const rest = prefs.suits === 'alternating' ? ALTERNATING_SUITS[trump].slice(1) : SUIT_ORDER.filter(suit => suit !== trump);
  return prefs.trump === 'left' ? [trump, ...rest] : [...rest, trump];
}

/** Return a sorted copy, leaving the hand and preferences unchanged. */
export function sortHand(hand: CardId[], trump: Suit | null, prefs: HandSortPrefs = DEFAULT_HAND_SORT): CardId[] {
  const suits = suitSequence(trump, prefs);
  const rankDirection = prefs.ranks === 'high-first' ? 1 : -1;
  return [...hand].sort((a, b) => {
    const A = parseCard(a), B = parseCard(b);
    return suits.indexOf(A.suit) - suits.indexOf(B.suit)
      || rankDirection * (RANK_ORDER.indexOf(A.rank) - RANK_ORDER.indexOf(B.rank))
      || a.localeCompare(b);
  });
}

export interface SuitMeld {
  suit: Suit;
  items: MeldItem[];
  total: number;
  cards: CardId[];
}

/** Evaluate each hypothetical trump in S H C D order, including zero meld. */
export function meldBySuit(hand: CardId[], rules: RulesConfig = DEFAULT_RULES): SuitMeld[] {
  return SUIT_ORDER.map(suit => {
    const { items, total } = computeMeld(hand, suit, rules);
    return { suit, items, total, cards: meldCards(items) };
  });
}

/** Union of meld cards in first-seen order across items. */
export function meldCards(items: MeldItem[]): CardId[] {
  return [...new Set(items.flatMap(item => item.cards))];
}

export function autoMeldSelection(hand: CardId[], trump: Suit): CardId[] {
  const inHand = new Set(hand);
  return meldCards(computeMeld(hand, trump).items).filter(card => inHand.has(card));
}
