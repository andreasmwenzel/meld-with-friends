import { describe, expect, it } from 'vitest';
import { describeConstraint, legalPlays, playConstraint, trickWinner } from '../index';
import type { PlayReason } from '../types';
import type { CardId, SeatIndex, Trick } from '../types';

function trick(...cards: CardId[]): Trick {
  return { leader: 0, plays: cards.map((card, seat) => ({ card, seat: seat as SeatIndex })), winner: null };
}
describe('trick rules', () => {
  it('allows any opening card and requires following suit', () => {
    expect(legalPlays(['9H0', 'AS0'], trick(), 'S')).toEqual(['9H0', 'AS0']);
    expect(legalPlays(['9H0', 'AS0'], trick('AH0'), 'S')).toEqual(['9H0']);
  });
  it('must head when following, even if a partner is winning', () => {
    expect(legalPlays(['9H0', 'KH0', 'TH0', 'AH0', 'AS0'], trick('QH0'), 'S')).toEqual(['KH0', 'TH0', 'AH0']);
    expect(legalPlays(['AH0', '9H0', 'AS0'], trick('KH0', '9S0'), 'S')).toEqual(['AH0', '9H0']);
  });
  it('must trump when void and overtrump if able', () => {
    expect(legalPlays(['9S0', 'AC0'], trick('AH0'), 'S')).toEqual(['9S0']);
    expect(legalPlays(['9S0', 'KS0', 'AS0', 'AC0'], trick('AH0', 'QS0'), 'S')).toEqual(['KS0', 'AS0']);
    expect(legalPlays(['9S0', 'JS0', 'AC0'], trick('AH0', 'QS0'), 'S')).toEqual(['9S0', 'JS0']);
    expect(legalPlays(['AC0', '9D0'], trick('AH0', 'QS0'), 'S')).toEqual(['AC0', '9D0']);
  });
  it('must follow and head when trump is led', () => {
    expect(legalPlays(['9S0', 'KS0', 'TS0', 'AC0'], trick('QS0'), 'S')).toEqual(['KS0', 'TS0']);
    expect(legalPlays(['9S0', 'JS0', 'AC0'], trick('AS0'), 'S')).toEqual(['9S0', 'JS0']);
  });
  it('keeps the first identical card as winner, ignores off-suit aces, and ranks ten above king', () => {
    expect(trickWinner(trick('AS0', 'AS1', 'KH0', '9D0'), 'S')).toBe(0);
    expect(trickWinner(trick('KH0', 'AC0', '9H0', '9D0'), 'S')).toBe(0);
    expect(trickWinner(trick('KH0', 'TH0', 'AH0', 'AH1'), 'S')).toBe(2);
    expect(trickWinner(trick('AH0', '9S0', 'TS0', 'KS0'), 'S')).toBe(2);
  });
});

const names = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' };
describe('play constraints', () => {
  const fixtures: { hand: CardId[]; plays: CardId[]; reason: PlayReason; mustBeat: CardId | null; legal: CardId[]; copy: string }[] = [
    { hand: ['9H0', 'AS0'], plays: [], reason: 'lead_any', mustBeat: null, legal: ['9H0', 'AS0'], copy: 'Any card.' },
    { hand: ['9H0', 'AS0'], plays: ['AH0'], reason: 'follow_suit', mustBeat: null, legal: ['9H0'], copy: 'Follow hearts.' },
    { hand: ['AH0', '9H0', 'AS0'], plays: ['KH0'], reason: 'must_head', mustBeat: 'KH0', legal: ['AH0'], copy: 'You must beat the K hearts.' },
    { hand: ['9S0', 'AC0'], plays: ['AH0'], reason: 'must_trump', mustBeat: null, legal: ['9S0'], copy: 'No hearts: you must trump.' },
    { hand: ['KS0', '9S0', 'AC0'], plays: ['QS0'], reason: 'must_overtrump', mustBeat: 'QS0', legal: ['KS0'], copy: 'Trump was led: play a higher trump if you can.' },
    { hand: ['KS0', '9S0', 'AC0'], plays: ['AH0', 'QS0'], reason: 'must_overtrump', mustBeat: 'QS0', legal: ['KS0'], copy: 'You must beat the Q spades.' },
    { hand: ['9S0', 'AC0'], plays: ['AH0', 'QS0'], reason: 'must_trump', mustBeat: null, legal: ['9S0'], copy: 'No hearts: you must trump.' },
    { hand: ['AC0', '9D0'], plays: ['AH0', 'QS0'], reason: 'any', mustBeat: null, legal: ['AC0', '9D0'], copy: 'Any card.' },
    { hand: ['AH0', '9H0', 'AS0'], plays: ['KH0', '9S0'], reason: 'follow_suit', mustBeat: null, legal: ['AH0', '9H0'], copy: 'Follow hearts.' },
    { hand: ['KS1', '9S0'], plays: ['KS0'], reason: 'follow_suit', mustBeat: null, legal: ['KS1', '9S0'], copy: 'Follow spades.' },
    { hand: ['KH1', '9H0'], plays: ['KH0'], reason: 'follow_suit', mustBeat: null, legal: ['KH1', '9H0'], copy: 'Follow hearts.' },
    { hand: ['KS1', 'AS0', '9S0'], plays: ['AH0', 'KS0'], reason: 'must_overtrump', mustBeat: 'KS0', legal: ['AS0'], copy: 'You must beat the K spades.' },
  ];
  it.each(fixtures)('$reason with $hand against $plays', ({ hand, plays, reason, mustBeat, legal, copy }) => {
    const current = trick(...plays);
    const c = playConstraint(hand, current, 'S');
    expect(c).toEqual({ reason, mustBeat, ledSuit: plays.length ? plays[0][1] : null });
    expect(legalPlays(hand, current, 'S')).toEqual(legal);
    expect(describeConstraint(c, names)).toBe(copy);
    expect(copy.length).toBeLessThan(60);
  });
  it('uses caller-provided suit glyphs in card references', () => {
    expect(describeConstraint({ reason: 'must_head', ledSuit: 'H', mustBeat: 'KH0' }, { S: '♠', H: '♥', D: '♦', C: '♣' })).toBe('You must beat the K♥.');
  });
});
