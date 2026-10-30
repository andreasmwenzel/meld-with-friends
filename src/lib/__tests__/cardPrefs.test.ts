import { describe, expect, it } from 'vitest';
import { DEFAULT_HAND_SORT, sortHand } from '@/engine/hand';
import { buildDeck, seededShuffle } from '@/engine/deck';
import type { CardId, Suit } from '@/engine/types';
import { parseCardPrefs } from '../cardPrefs';

const v1 = (sort: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ fourColour: true, bigIndex: false, size: 'l', sort, motion: 'quick', confirmPlay: true, autoMeld: false, ...extra });

describe('parseCardPrefs', () => {
  it('starts with trump on the left, high to low, and the trump tint on', () => {
    for (const raw of [null, '', '{}', 'not json', 'null']) {
      const prefs = parseCardPrefs(raw);
      expect(prefs.sort).toEqual(DEFAULT_HAND_SORT);
      expect(prefs.sort).toEqual({ suits: 'fixed', trump: 'left', ranks: 'high-first' });
      expect(prefs.trumpTint).toBe(true);
      expect(prefs.v).toBe(2);
    }
  });

  it.each([
    ['trump-first', { suits: 'fixed', trump: 'left' }],
    ['suits', { suits: 'fixed', trump: 'off' }],
    ['alternating', { suits: 'alternating', trump: 'left' }],
  ])('upgrades the version 1 order %s', (order, placed) => {
    for (const ranks of ['high-first', 'low-first']) {
      const prefs = parseCardPrefs(v1({ order, ranks }));
      expect(prefs.sort).toEqual({ ...placed, ranks });
      // Everything else is kept, and the new tint starts on.
      expect(prefs).toMatchObject({ fourColour: true, bigIndex: false, size: 'l', motion: 'quick', confirmPlay: true, autoMeld: false, trumpTint: true });
    }
  });

  // The version 1 sorter, kept here to prove upgraded preferences lay every hand out the same way.
  const V1_SUITS: Record<string, (trump: Suit | null) => Suit[]> = {
    'trump-first': t => (t ? [t, ...(['S', 'H', 'C', 'D'] as Suit[]).filter(s => s !== t)] : ['S', 'H', 'C', 'D']),
    suits: () => ['S', 'H', 'C', 'D'],
    alternating: t => (t ? ({ S: ['S', 'H', 'C', 'D'], H: ['H', 'S', 'D', 'C'], C: ['C', 'H', 'S', 'D'], D: ['D', 'S', 'H', 'C'] } as Record<Suit, Suit[]>)[t] : ['S', 'H', 'C', 'D']),
  };
  it.each(Object.keys(V1_SUITS))('keeps the hand order for version 1 %s', order => {
    const hand: CardId[] = seededShuffle(buildDeck(), order).slice(0, 12);
    for (const trump of [null, 'S', 'H', 'C', 'D'] as (Suit | null)[]) {
      for (const ranks of ['high-first', 'low-first']) {
        const { sort } = parseCardPrefs(v1({ order, ranks }));
        const seq = V1_SUITS[order](trump);
        const dir = ranks === 'high-first' ? 1 : -1;
        const RANKS = 'ATKQJ9';
        const expected = [...hand].sort((a, b) => seq.indexOf(a[1] as Suit) - seq.indexOf(b[1] as Suit) || dir * (RANKS.indexOf(a[0]) - RANKS.indexOf(b[0])) || a.localeCompare(b));
        expect(sortHand(hand, trump, sort)).toEqual(expected);
      }
    }
  });

  it('falls back to the default for an unknown version 1 order, keeping the ranks', () => {
    expect(parseCardPrefs(v1({ order: 'toString', ranks: 'low-first' })).sort).toEqual({ ...DEFAULT_HAND_SORT, ranks: 'low-first' });
    expect(parseCardPrefs(v1({ order: 'nonsense' })).sort).toEqual(DEFAULT_HAND_SORT);
  });

  it('reads version 2 as stored and rejects unknown values', () => {
    const stored = JSON.stringify({ v: 2, sort: { suits: 'alternating', trump: 'right', ranks: 'low-first' }, trumpTint: false });
    expect(parseCardPrefs(stored).sort).toEqual({ suits: 'alternating', trump: 'right', ranks: 'low-first' });
    expect(parseCardPrefs(stored).trumpTint).toBe(false);
    expect(parseCardPrefs(JSON.stringify({ v: 2, sort: { suits: 'x', trump: 'middle', ranks: 'y' } })).sort).toEqual(DEFAULT_HAND_SORT);
    expect(parseCardPrefs(JSON.stringify({ v: 2, sort: { suits: 'fixed', trump: 'off', ranks: 'high-first' } })).sort.trump).toBe('off');
  });

  it('keeps a chosen cloth and card back, and falls back to oxblood and the lattice otherwise', () => {
    expect(parseCardPrefs(null)).toMatchObject({ cloth: 'oxblood', back: 'lattice' });
    expect(parseCardPrefs(JSON.stringify({ v: 2, cloth: 'baize', back: 'rosette' }))).toMatchObject({ cloth: 'baize', back: 'rosette' });
    expect(parseCardPrefs(JSON.stringify({ v: 2, cloth: 'toString', back: 'plaid' }))).toMatchObject({ cloth: 'oxblood', back: 'lattice' });
    // Older stored options carry neither and keep everything else.
    expect(parseCardPrefs(v1({ order: 'suits' }))).toMatchObject({ cloth: 'oxblood', back: 'lattice', fourColour: true, size: 'l' });
  });

  it('prefers the version 2 fields when an old tab left a stray order behind', () => {
    const mixed = JSON.stringify({ sort: { order: 'suits', suits: 'fixed', trump: 'right', ranks: 'high-first' } });
    expect(parseCardPrefs(mixed).sort).toEqual({ suits: 'fixed', trump: 'right', ranks: 'high-first' });
  });
});
