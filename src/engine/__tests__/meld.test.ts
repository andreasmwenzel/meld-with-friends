import { describe, expect, it } from 'vitest';
import { buildDeck } from '../deck';
import { computeMeld } from '../meld';
import type { CardId } from '../types';

const run: CardId[] = ['AS0', 'TS0', 'KS0', 'QS0', 'JS0'];
describe('meld', () => {
  it('uses run K/Q only once and permits the extra royal marriage', () => {
    expect(computeMeld(run, 'S').total).toBe(150);
    expect(computeMeld([...run, 'KS1'], 'S').total).toBe(150);
    const result = computeMeld([...run, 'KS1', 'QS1'], 'S');
    expect(result.total).toBe(190);
    expect(result.items.find(item => item.kind === 'royal_marriage')?.cards).toEqual(['KS1', 'QS1']);
  });
  it('prefers a double run to two runs or royal marriages', () => {
    const cards = buildDeck().filter(c => c[1] === 'H' && c[0] !== '9');
    expect(computeMeld(cards, 'H').items).toMatchObject([{ kind: 'double_run', points: 1500 }]);
  });
  it('scores single and double pinochles', () => {
    expect(computeMeld(['QS0', 'JD0'], 'H').total).toBe(40);
    expect(computeMeld(['QS0', 'QS1', 'JD0', 'JD1'], 'H')).toMatchObject({ total: 300, items: [{ kind: 'double_pinochle' }] });
  });
  it.each([
    ['A', 100, 1000], ['K', 80, 800], ['Q', 60, 600], ['J', 40, 400],
  ] as const)('scores %s around and double around', (rank, single, double) => {
    const cards = buildDeck().filter(card => card[0] === rank);
    expect(computeMeld(cards.filter(card => card[2] === '0'), 'H').total).toBe(single);
    expect(computeMeld(cards, 'H').total).toBe(double);
  });
  it('scores each dix and each nontrump marriage', () => {
    expect(computeMeld(['9H0', '9H1', '9S0'], 'H').total).toBe(20);
    expect(computeMeld(['KC0', 'QC0', 'KC1', 'QC1'], 'H').total).toBe(40);
  });
  it('reuses cards across classes, but never within a class', () => {
    const cards: CardId[] = [...run, 'QH0', 'QD0', 'QC0', 'JD0', '9S0'];
    const result = computeMeld(cards, 'S');
    expect(result.total).toBe(260); // run + queens around + pinochle + dix
    expect(result.items.filter(item => item.cards.includes('QS0'))).toHaveLength(3);
    expect(computeMeld(['QS0', 'QS0', 'JD0', 'JD0'], 'H').total).toBe(40);
  });
  it('handles the full deck with all double classes and leftover marriages', () => {
    expect(computeMeld(buildDeck(), 'S').total).toBe(4740);
    expect(computeMeld([], 'S')).toEqual({ items: [], total: 0 });
  });
});
