import { describe, expect, it } from 'vitest';
import { applyAction, legalActionsFor, newGame, viewFor } from '../game';
import { qualifiesForMisdeal } from '../meld';
import { stackDeal } from '../scenario';
import { chooseAction } from '../ai';
import { adviseBid } from '../coach/advice';
import { IllegalAction, type CardId, type RulesConfig } from '../types';

// Five nines; aces and tens that make no around, no marriage, no pinochle and no run in any suit.
const NINES = ['9S', '9S', '9H', '9H', '9D', 'AS', 'AS', 'TS', 'TH', 'TD', 'AC', 'TC'];
const withMarriage = [...NINES.slice(0, 10), 'KH', 'QH'];
const fourNines = ['9S', '9S', '9H', '9H', 'JD', 'AS', 'AS', 'TS', 'TH', 'TD', 'AC', 'TC'];

// Dealer is East (3), so South (0) calls first and West (1) second.
const dealt = (hands: Record<number, string[]>, rules: Partial<RulesConfig> = {}) => stackDeal(newGame('nines', rules, 3), hands);

describe('nines misdeal', () => {
  it('qualifies five or more nines with no other meld in any trump', () => {
    expect(qualifiesForMisdeal(dealt({ 0: NINES }).players[0].hand)).toBe(true);
    // The nine of trump is dix, but it does not count as other meld.
    expect(qualifiesForMisdeal(['9S0', '9S1', '9H0', '9H1', '9D0', '9D1', 'AS0', 'TS0', 'TH0', 'AC0', 'TC0', 'TC1'] as CardId[])).toBe(true);
    expect(qualifiesForMisdeal(dealt({ 0: withMarriage }).players[0].hand)).toBe(false);
    expect(qualifiesForMisdeal(dealt({ 0: fourNines }).players[0].hand)).toBe(false);
  });

  it('lets a qualifying player throw the hand in on their first call, and the same dealer redeals', () => {
    const state = dealt({ 0: NINES });
    expect(legalActionsFor(state, 0).canMisdeal).toBe(true);
    const hand = [...state.players[0].hand];
    const after = applyAction(state, { type: 'misdeal', seat: 0 });
    expect(after.dealer).toBe(3);
    expect(after.handNumber).toBe(state.handNumber + 1);
    expect(after.phase).toBe('bidding');
    expect(after.turn).toBe(0);
    expect(after.bids).toEqual([]);
    expect(after.history).toEqual([]);
    expect(after.score).toEqual(state.score);
    expect(after.log.at(-2)).toBe('South throws in 5 nines and no meld; East redeals');
    // The thrown-in hand is shown to everyone while the new deal is bid.
    for (const seat of [0, 1, 2, 3] as const) expect(viewFor(after, seat).misdeal).toEqual({ seat: 0, hand });
    const next = applyAction(after, { type: 'pass_bid', seat: 0 });
    expect(viewFor(next, 1).misdeal).toEqual({ seat: 0, hand });
  });

  it('forgets the thrown-in hand once bidding ends or a new hand is dealt', () => {
    let state = applyAction(dealt({ 0: NINES }, { dealerStuck: true }), { type: 'misdeal', seat: 0 });
    for (const seat of [0, 1, 2] as const) state = applyAction(state, { type: 'pass_bid', seat });
    if (state.phase === 'bidding') state = applyAction(state, { type: 'pass_bid', seat: 3 });
    expect(state.phase).toBe('declaring_trump');
    expect(viewFor(state, 0).misdeal).toBeNull();
  });

  it('is gone after the player bids or passes, and is never offered off turn', () => {
    const state = dealt({ 0: NINES, 1: ['9C', '9C', '9D', 'KS', 'QS', 'AH', 'AH', 'TH', 'TD', 'AD', 'TC', 'AC'] });
    expect(legalActionsFor(state, 1).canMisdeal).toBe(false); // not West's turn yet
    const passed = applyAction(state, { type: 'pass_bid', seat: 0 });
    expect(legalActionsFor(passed, 0).canMisdeal).toBe(false);
    expect(() => applyAction(passed, { type: 'misdeal', seat: 0 })).toThrow(IllegalAction);
    const bid = applyAction(state, { type: 'bid', seat: 0, amount: 25 });
    expect(legalActionsFor(bid, 0).canMisdeal).toBe(false);
  });

  it('is still open to a later seat after others have called', () => {
    const state = dealt({ 1: NINES });
    const opened = applyAction(state, { type: 'bid', seat: 0, amount: 25 });
    expect(legalActionsFor(opened, 1).canMisdeal).toBe(true);
    expect(applyAction(opened, { type: 'misdeal', seat: 1 }).dealer).toBe(3);
  });

  it('refuses hands that do not qualify and tables with the rule off', () => {
    expect(legalActionsFor(dealt({ 0: withMarriage }), 0).canMisdeal).toBe(false);
    expect(legalActionsFor(dealt({ 0: fourNines }), 0).canMisdeal).toBe(false);
    const off = dealt({ 0: NINES }, { ninesMisdeal: false });
    expect(legalActionsFor(off, 0).canMisdeal).toBe(false);
    expect(() => applyAction(off, { type: 'misdeal', seat: 0 })).toThrow(IllegalAction);
  });

  it('defaults on, and old stored games without the setting get it too', () => {
    expect(newGame('x').rules.ninesMisdeal).toBe(true);
    const stored = dealt({ 0: NINES });
    const legacyRules: Partial<RulesConfig> = { ...stored.rules };
    delete legacyRules.ninesMisdeal;
    expect(legalActionsFor({ ...stored, rules: legacyRules as RulesConfig }, 0).canMisdeal).toBe(true);
  });

  it('computer players and the coach take the throw-in', () => {
    const view = viewFor(dealt({ 0: NINES }), 0);
    expect(chooseAction(view)).toEqual({ type: 'misdeal', seat: 0 });
    expect(adviseBid(view)?.action).toEqual({ type: 'misdeal', seat: 0 });
  });
});
