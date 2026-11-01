import { describe, expect, it } from 'vitest';
import { buildDeck } from '../deck';
import { choosePass } from '../ai/pass';
import { newGame, viewFor } from '../game';
import { computeMeld } from '../meld';
import type { CardId, PlayerView } from '../types';

function passingView(hand: CardId[], count = 4, phase: PlayerView['phase'] = 'passing_to_bidder'): PlayerView {
  const view = viewFor(newGame('passing'), 0);
  return { ...view, hand, trump: 'S', phase, legal: { ...view.legal, mustPassCount: count } };
}

const partnerHand: CardId[] = ['JH0', 'QH0', 'QH1', 'KH0', 'TH0', '9C0', 'QC0', 'KC0', 'TC0', 'TC1', '9S0', 'QS0'];

describe('passing conventions', () => {
  it('sends trump and tens without splitting either off-suit marriage', () => {
    const pass = choosePass(passingView(partnerHand));
    expect(pass).toHaveLength(4);
    expect(pass).toEqual(expect.arrayContaining(['QS0', '9S0']));
    expect(pass.filter(c => c[0] === 'K')).toEqual([]);
    expect(pass.filter(c => c[0] === 'T')).toHaveLength(2);
    const kept = partnerHand.filter(c => !pass.includes(c));
    expect(computeMeld(kept, 'S').items.filter(m => m.kind === 'marriage')).toHaveLength(2);
  });

  it('returns free kings and queens before nines and jacks, protecting its own meld', () => {
    const hand: CardId[] = ['AS0', '9S0', 'AH0', 'KH0', 'QH0', 'KD0', 'QC0', '9C0', 'JC0', 'QS0', 'JD0'];
    expect(choosePass(passingView(hand, 2, 'passing_back'))).toEqual(['QC0', 'KD0']);
    expect(choosePass(passingView(hand, 4, 'passing_back'))).toEqual(['QC0', 'KD0', '9C0', 'JC0']);
  });

  it('sends a whole marriage when the pass cannot be filled with free cards', () => {
    const hand: CardId[] = ['AS0', 'AH0', 'KH0', 'QH0', 'KC0', 'QC0'];
    const pass = choosePass(passingView(hand));
    expect(pass).toHaveLength(4);
    expect(pass).toEqual(expect.arrayContaining(['AS0', 'AH0']));
    expect(pass.includes('KH0')).toBe(pass.includes('QH0'));
    expect(pass.includes('KC0')).toBe(pass.includes('QC0'));
  });

  it('keeps a pinochle whole when only one non-trump slot is free', () => {
    const hand: CardId[] = ['QS0', 'JD0', 'TH0', 'TC0', '9H0'];
    const pass = choosePass({ ...passingView(hand, 2), trump: 'C' });
    expect(pass).toEqual(['TC0', 'TH0']);
  });

  it('prioritizes high trump, then aces, even when that breaks meld', () => {
    const hand: CardId[] = ['9S0', 'KS0', 'QS0', 'AS0', 'AH0', 'KH0', 'QH0'];
    expect(choosePass(passingView(hand, 2))).toEqual(['AS0', 'KS0']);
    expect(choosePass(passingView(hand, 5))).toEqual(expect.arrayContaining(['AS0', 'KS0', 'QS0', '9S0', 'AH0']));
  });

  it('passes pinochle intact and keeps it whole when only one filler slot is free', () => {
    const hand: CardId[] = ['QS0', 'JD0', 'TH0', 'TC0', '9H0'];
    expect(choosePass({ ...passingView(hand, 2), trump: 'H' })).toEqual(['TH0', '9H0']);
    expect(choosePass({ ...passingView(hand, 4), trump: 'H' })).toEqual(['TH0', '9H0', 'QS0', 'JD0']);
    const double: CardId[] = ['QS0', 'QS1', 'JD0', 'JD1', '9C0', 'TC0'];
    expect(choosePass({ ...passingView(double, 4), trump: 'H' })).toEqual(['QS0', 'QS1', 'JD0', 'JD1']);
  });

  it('sends the trump pinochle piece together with its mate before ace filler', () => {
    const hand: CardId[] = ['QS0', 'JD0', 'AS0', '9S0', 'AH0', 'AC0'];
    expect(choosePass(passingView(hand, 4))).toEqual(['AS0', 'QS0', '9S0', 'JD0']);
  });

  for (const trump of ['H', 'C'] as const) for (const piece of ['QS0', 'JD0'] as const) {
    it(`returns a lone ${piece} with ${trump} trump and returns a weak full pinochle together`, () => {
      const hand: CardId[] = [piece, '9H0', 'JH0', '9C0', 'JC0'];
      expect(choosePass({ ...passingView(hand, 1, 'passing_back'), trump })).toEqual([piece]);
      const paired: CardId[] = ['QS0', 'JD0', '9H0', 'JH0', '9C0', 'JC0'];
      const pass = choosePass({ ...passingView(paired, 2, 'passing_back'), trump });
      expect(pass).toEqual(expect.arrayContaining(['QS0', 'JD0']));
    });
  }

  it('returns weak pinochle pieces before marriage halves and keeps a promotable queen', () => {
    const weak: CardId[] = ['QS0', '9C0', 'KC0', 'QD0', 'JC0'];
    expect(choosePass({ ...passingView(weak, 1, 'passing_back'), trump: 'H' })).toEqual(['QS0']);
    expect(choosePass({ ...passingView([...weak, 'JD0'], 2, 'passing_back'), trump: 'H' }))
      .toEqual(['JD0', 'QS0']);
    const strong: CardId[] = ['AS0', 'AS1', 'TS0', 'KS0', 'QS0', '9C0'];
    expect(choosePass({ ...passingView(strong, 1, 'passing_back'), trump: 'H' })).toEqual(['9C0']);
  });

  it('keeps a double pinochle and never splits a single when returning cards', () => {
    const double: CardId[] = ['QS0', 'QS1', 'JD0', 'JD1', '9C0', 'JC0', '9D0', 'KC0'];
    expect(choosePass({ ...passingView(double, 4, 'passing_back'), trump: 'H' }))
      .toEqual(expect.arrayContaining(['9C0', 'JC0', '9D0', 'KC0']));
    const single: CardId[] = ['QS0', 'JD0', '9C0', 'KC0'];
    expect(choosePass({ ...passingView(single, 1, 'passing_back'), trump: 'H' })).toEqual(['KC0']);
  });

  for (const trump of ['S', 'D'] as const) {
    it(`keeps both pinochle pieces with ${trump} trump`, () => {
      for (const piece of ['QS0', 'JD0'] as const) {
        expect(choosePass({ ...passingView([piece, '9H0', 'JH0'], 2, 'passing_back'), trump }))
          .toEqual(['9H0', 'JH0']);
      }
    });
  }

  it('returns twelve distinct cards from an enlarged bidder hand', () => {
    const hand = buildDeck().slice(0, 24);
    const view = passingView(hand, 12, 'passing_back');
    const pass = choosePass(view);
    expect(pass).toHaveLength(12);
    expect(new Set(pass).size).toBe(12);
    expect(pass.every(c => hand.includes(c))).toBe(true);
    expect(choosePass({ ...view, hand: [...hand].reverse() })).toEqual(pass);
  });

  for (const phase of ['passing_to_bidder', 'passing_back'] as const) {
    it(`fills counts 0–12 deterministically with unique physical cards during ${phase}`, () => {
      for (let count = 0; count <= 12; count++) {
        // Repeated IDs must not be returned twice; TC0 and TC1 are separate cards.
        const view = passingView([...partnerHand, 'TC0', 'QH0'], count, phase);
        const pass = choosePass(view);
        expect(pass).toHaveLength(count);
        expect(new Set(pass).size).toBe(count);
        expect(pass.every(c => partnerHand.includes(c))).toBe(true);
        expect(choosePass(view)).toEqual(pass);
        expect(choosePass({ ...view, hand: [...view.hand].reverse() })).toEqual(pass);
      }
    });
  }
});
