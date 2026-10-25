import { parseCard, RANK_ORDER } from './deck';
import { computeMeld } from './meld';
import type { CardId, MeldItem, Suit } from './types';

export type HandSortOrder = 'trump-first' | 'suits' | 'alternating';
export type RankDirection = 'high-first' | 'low-first';

export interface HandSortPrefs {
  order: HandSortOrder;
  ranks: RankDirection;
}

export const DEFAULT_HAND_SORT: HandSortPrefs = { order: 'trump-first', ranks: 'high-first' };

const SUIT_ORDER: readonly Suit[] = ['S', 'H', 'C', 'D'];
const ALTERNATING_SUITS: Record<Suit, readonly Suit[]> = {
  S: ['S', 'H', 'C', 'D'],
  H: ['H', 'S', 'D', 'C'],
  C: ['C', 'H', 'S', 'D'],
  D: ['D', 'S', 'H', 'C'],
};

/** Return a sorted copy, leaving the hand and preferences unchanged. */
export function sortHand(hand: CardId[], trump: Suit | null, prefs: HandSortPrefs = DEFAULT_HAND_SORT): CardId[] {
  let suits = SUIT_ORDER;
  if (trump && prefs.order === 'trump-first') {
    suits = [trump, ...SUIT_ORDER.filter(suit => suit !== trump)];
  } else if (trump && prefs.order === 'alternating') {
    suits = ALTERNATING_SUITS[trump];
  }
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
export function meldBySuit(hand: CardId[]): SuitMeld[] {
  return SUIT_ORDER.map(suit => {
    const { items, total } = computeMeld(hand, suit);
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
