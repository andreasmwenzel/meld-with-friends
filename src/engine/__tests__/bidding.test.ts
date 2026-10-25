import { describe, expect, it } from 'vitest';
import { applyAction, legalActionsFor, newGame, viewFor } from '../game';
import { chooseAction } from '../ai';
import { randomAction } from '../ai/arena';
import { IllegalAction, type RulesConfig, type SeatIndex } from '../types';

const seats = [0, 1, 2, 3] as const;

function allOthersPassed(rules: Partial<RulesConfig> = {}, dealer: SeatIndex = 0) {
  let state = newGame('all-pass-regression', { scoring: 'classic', ...rules }, dealer);
  for (let i = 0; i < 3; i++) {
    state = applyAction(state, { type: 'pass_bid', seat: state.turn! });
  }
  return state;
}

describe('all-pass dealer decision', () => {
  for (const dealerStuck of [true, false]) {
    for (const shoot of ['off', 'game', 'points'] as const) {
      it.each(seats)(`restricts dealer %s with dealerStuck=${dealerStuck}, shoot=${shoot}`, dealer => {
        const state = allOthersPassed({ dealerStuck, shoot }, dealer);
        const legal = legalActionsFor(state, dealer);
        expect(legal).toMatchObject({ canBid: false, minBid: null, canPassBid: true, canShoot: shoot !== 'off' });
        expect(viewFor(state, dealer).legal).toEqual(legal);
        for (const amount of [250, 260, 1000]) {
          expect(() => applyAction(state, { type: 'bid', seat: dealer, amount })).toThrow(IllegalAction);
        }
        for (const seat of seats.filter(seat => seat !== dealer)) {
          expect(legalActionsFor(state, seat)).toMatchObject({ canBid: false, canPassBid: false, canShoot: false });
        }
        if (shoot === 'off') {
          expect(() => applyAction(state, { type: 'shoot', seat: dealer })).toThrow(IllegalAction);
        } else {
          const shot = applyAction(state, { type: 'shoot', seat: dealer });
          expect(shot).toMatchObject({ phase: 'declaring_trump', bidder: dealer, turn: dealer,
            highBid: { seat: dealer, amount: shoot === 'game' ? state.rules.target : state.rules.shootPoints, shoot: true } });
        }
        const taken = applyAction(state, { type: 'pass_bid', seat: dealer });
        if (dealerStuck) {
          expect(taken).toMatchObject({ phase: 'declaring_trump', bidder: dealer, turn: dealer,
            highBid: { seat: dealer, amount: 250 }, handNumber: 1 });
          expect(taken.players).toEqual(state.players);
        } else {
          expect(taken).toMatchObject({ phase: 'bidding', dealer: (dealer + 1) % 4,
            turn: (dealer + 2) % 4, handNumber: 2, highBid: null, bids: [], history: [], score: state.score });
          expect(taken.players).not.toEqual(state.players);
        }
      });
    }
  }

  it.each([200, 250, 300, 275])('takes the configured minimum %s without rescaling or rounding to bidStep', minBid => {
    const state = allOthersPassed({ minBid, bidStep: 20 });
    const taken = applyAction(state, { type: 'pass_bid', seat: 0 });
    expect(taken.highBid).toEqual({ seat: 0, amount: minBid });
    expect(taken.rules).toEqual(state.rules);
    expect(taken.score).toEqual({ red: 0, blue: 0 });
  });

  it.each(seats)('automatically awards an existing high bid to seat %s', bidder => {
    let state = newGame('existing-bid', { scoring: 'classic' }, ((bidder + 3) % 4) as SeatIndex);
    state = applyAction(state, { type: 'bid', seat: bidder, amount: 300 });
    for (let i = 0; i < 3; i++) state = applyAction(state, { type: 'pass_bid', seat: state.turn! });
    expect(state).toMatchObject({ phase: 'declaring_trump', bidder, turn: bidder, highBid: { seat: bidder, amount: 300 } });
    expect(viewFor(state, bidder).legal).toMatchObject({ canDeclareTrump: true, canBid: false, canPassBid: false });
  });

  it('keeps ordinary bids available before the third pass and with an outstanding bid', () => {
    let state = newGame('ordinary-auction', { scoring: 'classic' });
    for (const seat of [1, 2] as const) state = applyAction(state, { type: 'pass_bid', seat });
    expect(legalActionsFor(state, 3)).toMatchObject({ canBid: true, minBid: 250 });
    state = applyAction(state, { type: 'bid', seat: 3, amount: 250 });
    expect(legalActionsFor(state, 0)).toMatchObject({ canBid: true, minBid: 260 });
  });

  it.each([true, false])('lets both bot policies resolve the dealer decision with dealerStuck=%s', dealerStuck => {
    const state = allOthersPassed({ dealerStuck, shoot: 'game' });
    const view = viewFor(state, 0);
    // Force the strategic bot to decline shooting; a bid must still never be selected.
    const actions = [chooseAction(view, { budgetMs: 0, config: { shootMinTrump: 12 } }),
      randomAction(view, () => 0), randomAction(view, () => 0.99)];
    for (const action of actions) {
      expect(action).toEqual({ type: 'pass_bid', seat: 0 });
      const next = applyAction(state, action);
      expect(next.rev).toBe(state.rev + 1);
      expect(next.phase).toBe(dealerStuck ? 'declaring_trump' : 'bidding');
      expect(next.handNumber).toBe(dealerStuck ? 1 : 2);
    }
  });
});
