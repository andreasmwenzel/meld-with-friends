import { describe, expect, it } from 'vitest';
import { chooseAction } from '../ai';
import { applyAction, legalActionsFor, newGame, viewFor } from '../game';
import { applyPublicMove, publicMove } from '../publicMove';
import { buildReplay, describeStep, expandReplay, rebuildFromLog } from '../replay';
import { buildScenario } from '../scenario';
import { presetById } from '../scenarios';
import type { Action, GameState, RulesConfig, SeatIndex } from '../types';

const seats = [0, 1, 2, 3] as const;
const name = (seat: SeatIndex) => ['South', 'West', 'North', 'East'][seat];

/** West takes the bid at 25 and names spades; with passing on, East (West's partner) and West swap cards. */
function toDecision(rules: Partial<RulesConfig>): GameState {
  let state = newGame('after-pass', { scoring: 'modern', shoot: 'points', shootPoints: 100, ...rules });
  state = applyAction(state, { type: 'bid', seat: 1, amount: 25 });
  for (const seat of [2, 3, 0] as const) state = applyAction(state, { type: 'pass_bid', seat });
  state = applyAction(state, { type: 'declare_trump', seat: 1, suit: 'S' });
  if (state.phase === 'passing_to_bidder') {
    const n = state.rules.passCount;
    state = applyAction(state, { type: 'pass_cards', seat: 3, cards: state.players[3].hand.slice(0, n) });
    state = applyAction(state, { type: 'pass_cards', seat: 1, cards: state.players[1].hand.slice(0, n) });
  }
  return state;
}

/** Everyone lays down nothing and confirms, then the bots play the hand out. */
function playOut(state: GameState): GameState {
  for (const seat of seats) state = applyAction(state, { type: 'confirm_meld', seat });
  while (state.phase === 'playing') state = applyAction(state, chooseAction(viewFor(state, state.turn!), { seed: `${state.rev}`, config: { samples: 4, budgetMs: 2 } }));
  return state;
}

describe('the bidder decides on a shoot after the pass', () => {
  it.each([4, 0])('stops for the bidder alone once the cards are passed (passCount %i)', passCount => {
    const state = toDecision({ passCount });
    expect(state).toMatchObject({ phase: 'deciding_shoot', turn: 1, bidder: 1 });
    expect(legalActionsFor(state, 1)).toMatchObject({ canShoot: true, canDeclineShoot: true, canDeclareMeld: false, canConfirmMeld: false, canBid: false });
    for (const seat of [0, 2, 3] as const) {
      expect(legalActionsFor(state, seat)).toMatchObject({ canShoot: false, canDeclineShoot: false, canDeclareMeld: false, canConfirmMeld: false });
      expect(() => applyAction(state, { type: 'shoot', seat })).toThrow();
      expect(() => applyAction(state, { type: 'decline_shoot', seat })).toThrow();
    }
    // Nobody lays meld down before the decision, so automatic meld has nothing to do yet.
    for (const seat of seats) {
      expect(() => applyAction(state, { type: 'declare_meld', seat, cards: [] })).toThrow();
      expect(() => applyAction(state, { type: 'confirm_meld', seat })).toThrow();
    }
    expect(viewFor(state, 0).recap.passing.done).toBe(true);
  });

  it('turns the contract into a shoot at the same stake as the auction, then melds and scores it as one', () => {
    const decided = toDecision({ passCount: 4 });
    let state = applyAction(decided, { type: 'shoot', seat: 1 });
    expect(state.highBid).toEqual({ seat: 1, amount: 100, shoot: true });
    expect(state.bids).toEqual(decided.bids);
    expect(state).toMatchObject({ phase: 'melding', turn: null });
    expect(state.log.at(-1)).toBe('West shoots the moon');
    expect(legalActionsFor(state, 1)).toMatchObject({ canShoot: false, canDeclineShoot: false, canDeclareMeld: true, canConfirmMeld: true });
    expect(describeStep({ type: 'shoot', seat: 1 }, decided, state, name)).toBe('West shoots the moon after the pass');
    expect(viewFor(state, 0).highBid?.shoot).toBe(true);
    state = playOut(state);
    const record = state.history.at(-1)!;
    expect(record.shotMade).toBeDefined();
    expect(record.breakdown.blue.shoot).toBe(record.shotMade ? 100 : -100);
  });

  it('plays the contract out on a decline, and the shoot is gone for the hand', () => {
    const decided = toDecision({ passCount: 4 });
    let state = applyAction(decided, { type: 'decline_shoot', seat: 1 });
    expect(state.highBid).toEqual({ seat: 1, amount: 25 });
    expect(state).toMatchObject({ phase: 'melding', turn: null });
    expect(state.log.at(-1)).toBe('West plays it out');
    expect(legalActionsFor(state, 1).canShoot).toBe(false);
    expect(() => applyAction(state, { type: 'shoot', seat: 1 })).toThrow();
    state = playOut(state);
    expect(state.history.at(-1)!.shotMade).toBeUndefined();
  });

  it('is skipped with shooting off, and after a shoot in the auction', () => {
    expect(toDecision({ shoot: 'off', passCount: 4 }).phase).toBe('melding');
    expect(toDecision({ shoot: 'off', passCount: 0 }).phase).toBe('melding');
    let state = newGame('auction-shoot', { scoring: 'modern', shoot: 'game', passCount: 0 });
    state = applyAction(state, { type: 'shoot', seat: 1 });
    for (const seat of [2, 3, 0] as const) state = applyAction(state, { type: 'pass_bid', seat });
    state = applyAction(state, { type: 'declare_trump', seat: 1, suit: 'H' });
    expect(state.phase).toBe('melding');
    expect(legalActionsFor(state, 1)).toMatchObject({ canShoot: false, canDeclineShoot: false });
  });

  it('lets bots decide with the auction test, in the named trump', () => {
    const strong = ['AS', 'AS', 'TS', 'TS', 'KS', 'KS', 'QS', 'QS', 'JS', 'AH', 'AD', 'AC'];
    const spec = { dealer: 0 as const, bidder: 1 as const, bid: 25, rules: { scoring: 'modern' as const, shoot: 'points' as const, passCount: 0 }, hands: { 1: strong }, to: 'deciding_shoot' as const };
    const inSpades = buildScenario({ ...spec, trump: 'S' }).state;
    expect(chooseAction(viewFor(inSpades, 1))).toEqual({ type: 'shoot', seat: 1 });
    // The same cards with hearts named are no shoot: the long suit is not trump.
    const inHearts = buildScenario({ ...spec, trump: 'H' }).state;
    expect(inHearts.phase).toBe('deciding_shoot');
    expect(chooseAction(viewFor(inHearts, 1))).toEqual({ type: 'decline_shoot', seat: 1 });
  });

  it('broadcasts both decisions as public moves', () => {
    const decided = toDecision({ passCount: 4 });
    for (const action of [{ type: 'shoot', seat: 1 }, { type: 'decline_shoot', seat: 1 }] as Action[]) {
      const next = applyAction(decided, action);
      const move = publicMove(decided, next, action);
      expect(move?.action).toEqual(action);
      for (const seat of seats) expect(applyPublicMove(viewFor(decided, seat), move!)).toEqual(viewFor(next, seat));
    }
  });

  it('has a lab preset at the decision', () => {
    const state = buildScenario(presetById('shoot-after-pass')!.spec).state;
    expect(state).toMatchObject({ phase: 'deciding_shoot', bidder: 0, turn: 0 });
    expect(viewFor(state, 0).legal).toMatchObject({ canShoot: true, canDeclineShoot: true });
  });
});

describe('replays with the decision', () => {
  function game(shootAfterPass: boolean): { start: GameState; actions: Action[]; final: GameState } {
    const start = newGame('replay-decision', { scoring: 'modern', shoot: 'points', shootPoints: 100, target: 120 }, 3);
    let state = start;
    const actions: Action[] = [];
    while (state.history.length < 2 && state.phase !== 'game_over') {
      const seat = state.phase === 'melding' ? seats.find(s => !state.players[s].meldConfirmed)! : state.phase === 'hand_over' ? 0 : state.turn!;
      const action: Action = state.phase === 'deciding_shoot' && shootAfterPass ? { type: 'shoot', seat }
        : state.phase === 'hand_over' ? { type: 'next_hand', seat }
        : chooseAction(viewFor(state, seat), { seed: `${state.rev}`, config: { samples: 4, budgetMs: 2 } });
      state = applyAction(state, action);
      actions.push(action);
    }
    return { start, actions, final: state };
  }

  it.each([true, false])('round-trips a game through the log (shoot after the pass: %s)', shootAfterPass => {
    const { actions, final } = game(shootAfterPass);
    expect(actions.some(a => a.type === (shootAfterPass ? 'shoot' : 'decline_shoot'))).toBe(true);
    const rebuilt = rebuildFromLog(final, actions)!;
    expect(rebuilt.actions).toEqual(actions);
    const replay = buildReplay(rebuilt.states, rebuilt.actions)!;
    expect(expandReplay(replay).at(-1)!.score).toEqual(final.score);
  });

  it('still replays a game logged before the decision existed, as the bidder playing it out', () => {
    const { actions, final } = game(false);
    const declines = actions.filter(a => a.type === 'decline_shoot').length;
    expect(declines).toBeGreaterThan(0);
    // An older log: no decisions, and the stored game has that many fewer revisions.
    const older = actions.filter(a => a.type !== 'decline_shoot');
    const rebuilt = rebuildFromLog({ ...final, rev: final.rev - declines }, older)!;
    expect(rebuilt).not.toBeNull();
    expect(rebuilt.actions).toEqual(actions);
    expect(rebuilt.states.at(-1)!.score).toEqual(final.score);
  });
  it.each([4, 0])('replays an older log that ends on the pass into meld (passCount %i)', passCount => {
    // Logged before the decision existed: the last action took the hand straight to meld.
    let state = newGame('after-pass', { scoring: 'modern', shoot: 'points', shootPoints: 100, passCount }, 0);
    const older: Action[] = [{ type: 'bid', seat: 1, amount: 25 }, ...[2, 3, 0].map(seat => ({ type: 'pass_bid', seat }) as Action), { type: 'declare_trump', seat: 1, suit: 'S' }];
    for (const action of older) state = applyAction(state, action);
    if (passCount) {
      for (const seat of [3, 1] as const) {
        const action: Action = { type: 'pass_cards', seat, cards: state.players[seat].hand.slice(0, passCount) };
        state = applyAction(state, action);
        older.push(action);
      }
    }
    expect(state.phase).toBe('deciding_shoot');
    const decline: Action = { type: 'decline_shoot', seat: 1 };
    const melding = applyAction(state, decline);
    // The stored game is in meld, one revision behind the replay because it never took the decision.
    const rebuilt = rebuildFromLog({ ...melding, rev: melding.rev - 1 }, older)!;
    expect(rebuilt).not.toBeNull();
    expect(rebuilt.actions).toEqual([...older, decline]);
    expect(rebuilt.states.at(-1)!.phase).toBe('melding');
    // A game stored at the decision itself is left waiting on it.
    expect(rebuildFromLog(state, older)!.actions).toEqual(older);
  });
});
