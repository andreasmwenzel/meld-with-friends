import { describe, expect, it } from 'vitest';
import { buildDeck, cardLabel, parseCard, RANK_ORDER, seededShuffle } from '../deck';

describe('deck', () => {
  it('contains exactly two copies of each rank/suit combination', () => {
    const deck = buildDeck();
    expect(deck).toHaveLength(48);
    expect(new Set(deck).size).toBe(48);
    for (const rank of RANK_ORDER) for (const suit of ['S', 'H', 'D', 'C']) {
      expect(deck.filter(card => card.startsWith(`${rank}${suit}`))).toHaveLength(2);
    }
    expect(parseCard('AS1')).toEqual({ rank: 'A', suit: 'S', copy: 1 });
    expect(cardLabel('TH0')).toBe('10♥');
    expect(RANK_ORDER).toEqual(['A', 'T', 'K', 'Q', 'J', '9']);
  });
  it('shuffles deterministically without mutating or losing cards', () => {
    const deck = buildDeck();
    const original = [...deck];
    expect(seededShuffle(deck, 'seed')).toEqual(seededShuffle(deck, 'seed'));
    expect(seededShuffle(deck, 'seed')).not.toEqual(seededShuffle(deck, 'other'));
    expect(seededShuffle(deck, 'seed').sort()).toEqual([...deck].sort());
    expect(deck).toEqual(original);
  });
});
