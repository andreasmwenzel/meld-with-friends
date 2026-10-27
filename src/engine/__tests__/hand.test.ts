import { describe, expect, it } from 'vitest';
import { buildDeck, seededShuffle } from '../deck';
import {
  autoMeldSelection, DEFAULT_HAND_SORT, meldBySuit, meldCards, sortHand, suitSequence,
  type RankDirection, type SuitOrder, type TrumpPlacement,
} from '../hand';
import { computeMeld } from '../meld';
import type { CardId, MeldItem, Suit } from '../types';

const suits: Suit[] = ['S', 'H', 'C', 'D'];
const overlappingMeld: CardId[] = [
  'AS0', 'TS0', 'KS0', 'QS0', 'JS0', 'QH0', 'QC0', 'QD0', 'JD0', '9S0', 'TH0',
];

describe('sortHand', () => {
  // Suits left to right for trump none, S, H, C, D.
  const sequences: { suits: SuitOrder; trump: TrumpPlacement; expected: string[] }[] = [
    { suits: 'fixed', trump: 'left', expected: ['SHCD', 'SHCD', 'HSCD', 'CSHD', 'DSHC'] },
    { suits: 'fixed', trump: 'right', expected: ['SHCD', 'HCDS', 'SCDH', 'SHDC', 'SHCD'] },
    { suits: 'fixed', trump: 'off', expected: ['SHCD', 'SHCD', 'SHCD', 'SHCD', 'SHCD'] },
    { suits: 'alternating', trump: 'left', expected: ['SHCD', 'SHCD', 'HSDC', 'CHSD', 'DSHC'] },
    { suits: 'alternating', trump: 'right', expected: ['SHCD', 'HCDS', 'SDCH', 'HSDC', 'SHCD'] },
    { suits: 'alternating', trump: 'off', expected: ['SHCD', 'SHCD', 'SHCD', 'SHCD', 'SHCD'] },
  ];
  const rankOrders: Record<RankDirection, string[]> = {
    'high-first': ['A', 'T', 'K', 'Q', 'J', '9'],
    'low-first': ['9', 'J', 'Q', 'K', 'T', 'A'],
  };
  const fullHand = seededShuffle(buildDeck(), 'every combination');
  for (const { suits: suitOrder, trump: placement, expected } of sequences) {
    for (const ranks of ['high-first', 'low-first'] as RankDirection[]) {
      it.each([null, ...suits])(`lays out ${suitOrder} suits, trump ${placement}, ${ranks}, with trump %s`, trump => {
        const order = expected[trump === null ? 0 : suits.indexOf(trump) + 1];
        const prefs = { suits: suitOrder, trump: placement, ranks };
        expect(suitSequence(trump, prefs).join('')).toBe(order);
        const want = [...order].flatMap(suit => rankOrders[ranks].flatMap(rank => [`${rank}${suit}0`, `${rank}${suit}1`]));
        expect(sortHand(fullHand, trump, prefs)).toEqual(want);
      });
    }
  }

  it.each(suits)('puts trump at the far right with Right, and the other suits in the Left order (trump %s)', trump => {
    for (const suitOrder of ['fixed', 'alternating'] as SuitOrder[]) {
      const left = suitSequence(trump, { suits: suitOrder, trump: 'left' });
      const right = suitSequence(trump, { suits: suitOrder, trump: 'right' });
      expect(right).toEqual([...left.slice(1), trump]);
    }
  });

  it('alternates colours with alternating suits whenever trump moves', () => {
    const red = (suit: string) => suit === 'H' || suit === 'D';
    for (const trump of suits) {
      for (const placement of ['left', 'right'] as TrumpPlacement[]) {
        const seq = suitSequence(trump, { suits: 'alternating', trump: placement });
        for (let i = 1; i < seq.length; i++) expect(red(seq[i])).not.toBe(red(seq[i - 1]));
      }
    }
  });

  it.each<RankDirection>(['high-first', 'low-first'])('sorts every rank within each suit %s', ranks => {
    const expectedRanks = ranks === 'high-first' ? ['A', 'T', 'K', 'Q', 'J', '9'] : ['9', 'J', 'Q', 'K', 'T', 'A'];
    const expected = suits.flatMap(suit => expectedRanks.map(rank => `${rank}${suit}0`));
    const hand = seededShuffle(buildDeck().filter(card => card[2] === '0'), 'rank order');
    expect(sortHand(hand, null, { suits: 'fixed', trump: 'off', ranks })).toEqual(expected);
  });

  it('defaults to trump on the left and high-first without mutating its inputs', () => {
    const hand: CardId[] = ['9S0', 'KH0', 'AD0', 'TS0', 'AC0', 'AH0', 'AS0'];
    const original = [...hand];
    const prefs = { ...DEFAULT_HAND_SORT };
    expect(prefs).toEqual({ suits: 'fixed', trump: 'left', ranks: 'high-first' });
    expect(sortHand(hand, 'H')).toEqual(['AH0', 'KH0', 'AS0', 'TS0', '9S0', 'AC0', 'AD0']);
    expect(sortHand(hand, 'H', prefs)).toEqual(sortHand(hand, 'H'));
    expect(hand).toEqual(original);
    expect(prefs).toEqual(DEFAULT_HAND_SORT);
    expect(sortHand(hand, null)).not.toBe(hand);
  });

  it.each<RankDirection>(['high-first', 'low-first'])('breaks ties by id regardless of input order for %s', ranks => {
    const hand: CardId[] = ['AS1', 'AS0', 'AS1', 'AS0', 'TS1', 'TS0'];
    const expected = ranks === 'high-first'
      ? ['AS0', 'AS0', 'AS1', 'AS1', 'TS0', 'TS1']
      : ['TS0', 'TS1', 'AS0', 'AS0', 'AS1', 'AS1'];
    for (let seed = 0; seed < 5; seed++) {
      expect(sortHand(seededShuffle(hand, String(seed)), 'S', { suits: 'fixed', trump: 'off', ranks })).toEqual(expected);
    }
  });

  it('returns an empty hand', () => {
    expect(sortHand([], null)).toEqual([]);
  });
});

describe('meldBySuit', () => {
  it.each([{ hand: overlappingMeld }, { hand: buildDeck() }])('matches computeMeld for each hypothetical trump', ({ hand }) => {
    const original = [...hand];
    const results = meldBySuit(hand);
    expect(results.map(result => result.suit)).toEqual(suits);
    for (const result of results) {
      const expected = computeMeld(hand, result.suit);
      expect(result.total).toBe(expected.total);
      expect(result.items).toEqual(expected.items);
      expect(result.cards).toEqual(meldCards(expected.items));
      expect(new Set(result.cards).size).toBe(result.cards.length);
    }
    expect(hand).toEqual(original);
  });

  it('includes all suits even when none have meld', () => {
    for (const hand of [[], ['AS0', 'TH0'] as CardId[]]) {
      expect(meldBySuit(hand)).toEqual(suits.map(suit => ({ suit, items: [], total: 0, cards: [] })));
    }
  });
});

describe('meldCards', () => {
  it('deduplicates within and across items in first-seen order', () => {
    const items: MeldItem[] = [
      { kind: 'pinochle', cards: ['QS1', 'JD0', 'QS1'], points: 40 },
      { kind: 'marriage', cards: ['KS0', 'QS1'], points: 20 },
      { kind: 'pinochle', cards: ['QS0', 'JD0'], points: 40 },
    ];
    const original = structuredClone(items);
    expect(meldCards(items)).toEqual(['QS1', 'JD0', 'KS0', 'QS0']);
    expect(items).toEqual(original);
  });

  it('returns an empty selection for no items', () => {
    expect(meldCards([])).toEqual([]);
  });
});

describe('autoMeldSelection', () => {
  it.each(suits)('selects all meld using only cards in hand for trump %s', trump => {
    const hand: CardId[] = [...overlappingMeld, 'QS0'];
    const original = [...hand];
    const { items, total } = computeMeld(hand, trump);
    const selected = autoMeldSelection(hand, trump);
    expect(selected).toEqual(meldCards(items));
    expect(new Set(selected).size).toBe(selected.length);
    expect(selected.every(card => hand.includes(card))).toBe(true);
    expect(selected).not.toContain('TH0');
    for (const item of items) {
      expect(item.cards.every(card => selected.includes(card))).toBe(true);
    }
    expect(computeMeld(selected, trump).total).toBe(total);
    expect(hand).toEqual(original);
  });

  it('returns an empty selection for empty hands and hands with no meld', () => {
    expect(autoMeldSelection([], 'S')).toEqual([]);
    expect(autoMeldSelection(['AS0', 'TH0'], 'S')).toEqual([]);
  });
});
