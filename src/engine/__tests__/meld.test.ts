import { describe, expect, it } from 'vitest';
import { buildDeck } from '../deck';
import { computeMeld } from '../meld';
import type { CardId, MeldKind, Suit } from '../types';

const classicMeld = (cards: CardId[], trump: Suit) => computeMeld(cards, trump, { scoring: 'classic' });

const run: CardId[] = ['AS0', 'TS0', 'KS0', 'QS0', 'JS0'];
describe('meld', () => {
  it('uses run K/Q only once and permits the extra royal marriage', () => {
    expect(classicMeld(run, 'S').total).toBe(150);
    expect(classicMeld([...run, 'KS1'], 'S').total).toBe(150);
    const result = classicMeld([...run, 'KS1', 'QS1'], 'S');
    expect(result.total).toBe(190);
    expect(result.items.find(item => item.kind === 'royal_marriage')?.cards).toEqual(['KS1', 'QS1']);
  });
  it('prefers a double run to two runs or royal marriages', () => {
    const cards = buildDeck().filter(c => c[1] === 'H' && c[0] !== '9');
    expect(classicMeld(cards, 'H').items).toMatchObject([{ kind: 'double_run', points: 1500 }]);
  });
  it('scores single and double pinochles', () => {
    expect(classicMeld(['QS0', 'JD0'], 'H').total).toBe(40);
    expect(classicMeld(['QS0', 'QS1', 'JD0', 'JD1'], 'H')).toMatchObject({ total: 300, items: [{ kind: 'double_pinochle' }] });
  });
  it.each([
    ['A', 100, 1000], ['K', 80, 800], ['Q', 60, 600], ['J', 40, 400],
  ] as const)('scores %s around and double around', (rank, single, double) => {
    const cards = buildDeck().filter(card => card[0] === rank);
    expect(classicMeld(cards.filter(card => card[2] === '0'), 'H').total).toBe(single);
    expect(classicMeld(cards, 'H').total).toBe(double);
  });
  it('scores each dix and each nontrump marriage', () => {
    expect(classicMeld(['9H0', '9H1', '9S0'], 'H').total).toBe(20);
    expect(classicMeld(['KC0', 'QC0', 'KC1', 'QC1'], 'H').total).toBe(40);
  });
  it('reuses cards across classes, but never within a class', () => {
    const cards: CardId[] = [...run, 'QH0', 'QD0', 'QC0', 'JD0', '9S0'];
    const result = classicMeld(cards, 'S');
    expect(result.total).toBe(260); // run + queens around + pinochle + dix
    expect(result.items.filter(item => item.cards.includes('QS0'))).toHaveLength(3);
    expect(classicMeld(['QS0', 'QS0', 'JD0', 'JD0'], 'H').total).toBe(40);
  });
  it('handles the full deck with all double classes and leftover marriages', () => {
    expect(classicMeld(buildDeck(), 'S').total).toBe(4740);
    expect(classicMeld([], 'S')).toEqual({ items: [], total: 0 });
  });
});


describe('modern meld', () => {
  const cases: [MeldKind, CardId[], Suit, number][] = [
    ['run', run, 'S', 15],
    ['double_run', buildDeck().filter(c => c[1] === 'S' && c[0] !== '9'), 'S', 150],
    ['royal_marriage', ['KS0', 'QS0'], 'S', 4],
    ['marriage', ['KH0', 'QH0'], 'S', 2],
    ['dix', ['9S0'], 'S', 1],
    ['pinochle', ['QS0', 'JD0'], 'H', 4],
    ['double_pinochle', ['QS0', 'QS1', 'JD0', 'JD1'], 'H', 30],
    ...(['A', 'K', 'Q', 'J'] as const).flatMap((rank, i): [MeldKind, CardId[], Suit, number][] => {
      const names = ['aces', 'kings', 'queens', 'jacks'] as const;
      const cards = buildDeck().filter(c => c[0] === rank);
      return [
        [`${names[i]}_around`, cards.filter(c => c[2] === '0'), 'H', [10, 8, 6, 4][i]],
        [`double_${names[i]}_around`, cards, 'H', [100, 80, 60, 40][i]],
      ];
    }),
  ];

  it.each(cases)('scores %s in integer modern units', (kind, cards, trump, expected) => {
    const modern = computeMeld(cards, trump);
    expect(modern.items.find(item => item.kind === kind)?.points).toBe(expected);
    const classic = classicMeld(cards, trump);
    expect(modern.total * 10).toBe(classic.total);
    expect(modern.items.every(item => Number.isInteger(item.points))).toBe(true);
  });
});
