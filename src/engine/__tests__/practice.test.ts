import { describe, expect, it } from 'vitest';
import { applyAction, buildDeck, computeMeld, newGame, newPracticeGame, viewFor } from '../index';
import { chooseAction } from '../ai';
import { bestTrump, projectedValue } from '../ai/bid';
import type { CardId, GameState } from '../types';

const dealt: CardId[][] = [
  ['TH1', 'QH1', 'TC1', 'KH1', 'JD0', 'AH1', '9C0', 'KS0', 'KC1', 'AS1', '9H0', 'QS0'],
  ['JC1', 'QH0', 'QS1', 'QC0', 'QD1', 'TH0', 'AC1', 'TC0', '9H1', 'JD1', 'QD0', 'TD1'],
  ['JH1', 'TS0', '9S1', 'KD0', 'AS0', 'TS1', 'KS1', '9D1', 'KH0', '9C1', 'AD0', 'KD1'],
  ['9D0', 'JS0', 'AH0', 'AC0', 'JH0', 'QC1', 'JC0', '9S0', 'AD1', 'KC0', 'JS1', 'TD0'],
];

function winBid(): GameState {
  let state = newPracticeGame();
  for (const expected of [
    { type: 'bid', seat: 1, amount: 25 },
    { type: 'pass_bid', seat: 2 },
    { type: 'bid', seat: 3, amount: 26 },
  ]) {
    const action = chooseAction(viewFor(state, state.turn!));
    expect(action).toEqual(expected);
    state = applyAction(state, action);
  }
  state = applyAction(state, { type: 'bid', seat: 0, amount: 31 });
  for (const seat of [1, 3] as const) {
    const action = chooseAction(viewFor(state, seat));
    expect(action).toEqual({ type: 'pass_bid', seat });
    state = applyAction(state, action);
  }
  expect(state).toMatchObject({ phase: 'declaring_trump', bidder: 0, highBid: { amount: 31 } });
  return state;
}

describe('curated practice deal', () => {
  it('pins a legal opening deal with default rules and no preplayed decisions', () => {
    const state = newPracticeGame();
    expect(state.players.map(player => player.hand)).toEqual(dealt);
    expect(state.players.flatMap(player => player.hand).sort()).toEqual(buildDeck().sort());
    expect(state).toMatchObject({
      phase: 'bidding', dealer: 0, turn: 1, handNumber: 1, rev: 0,
      bids: [], bidder: null, trump: null, score: { red: 0, blue: 0 }, history: [],
    });
    expect(state.rules).toEqual(newGame('ordinary-table').rules);
    expect(viewFor(state, 0).revealed).toBeNull();
  });

  it('makes hearts the clear trump choice without a ready-made run', () => {
    const state = newPracticeGame();
    const view = viewFor(state, 0);
    expect(view.hand.filter(card => card[0] === 'A')).toHaveLength(2);
    expect(view.hand.filter(card => card[1] === 'H')).toHaveLength(5);
    expect(view.hand.filter(card => card[1] === 'S')).toHaveLength(3);
    expect(bestTrump(view)).toBe('H');
    expect(projectedValue(view, 'H')).toBeGreaterThan(projectedValue(view, 'S'));
    expect(computeMeld(view.hand, 'H').total).toBe(11);
    expect(computeMeld(view.hand, 'S').total).toBe(10);
    expect(computeMeld(view.hand, 'D').total).toBe(8);
    expect(computeMeld(view.hand, 'C').total).toBe(9);
    expect(computeMeld(view.hand, 'H').items.some(item => item.kind === 'run')).toBe(false);
  });

  it('has both opponents bid once and pass their second turn after a raise to 31', () => {
    winBid();
  });

  it('supports the actual bot pass, a heart run, and a complete legal hand', () => {
    let state = applyAction(winBid(), { type: 'declare_trump', seat: 0, suit: 'H' });
    const sent: CardId[] = ['KH0', 'JH1', 'AD0', 'AS0'];
    const returned: CardId[] = ['9C0', 'KC1', 'TC1', 'KS0'];
    const pass = chooseAction(viewFor(state, 2));
    expect(pass).toEqual({ type: 'pass_cards', seat: 2, cards: sent });
    state = applyAction(state, pass);
    const back = chooseAction(viewFor(state, 0));
    expect(back).toEqual({ type: 'pass_cards', seat: 0, cards: returned });
    state = applyAction(state, back);
    const atPlay = state.players.map(player => [...player.hand]);
    expect(atPlay.map(hand => hand.length)).toEqual([12, 12, 12, 12]);
    expect(atPlay.flat().sort()).toEqual(buildDeck().sort());
    for (const seat of [0, 1, 2, 3] as const) {
      state = applyAction(state, { type: 'declare_meld', seat, cards: state.players[seat].hand });
      state = applyAction(state, { type: 'confirm_meld', seat });
    }
    expect(state.players[0].meldPoints).toBe(20);
    expect(state.players[0].meld.some(item => item.kind === 'run')).toBe(true);
    for (let i = 0; i < 48; i++) {
      const seat = state.turn!;
      state = applyAction(state, { type: 'play_card', seat, card: viewFor(state, seat).legal.playableCards[0] });
    }
    expect(state.phase).toBe('hand_over');
    expect(state.tricksTaken.red.length + state.tricksTaken.blue.length).toBe(12);
    expect([...state.tricksTaken.red.flat(), ...state.tricksTaken.blue.flat()].sort()).toEqual(buildDeck().sort());
    const view = viewFor(state, 0);
    expect(Object.values(view.revealed!.dealt)).toEqual(dealt);
    expect(Object.values(view.revealed!.atPlay)).toEqual(atPlay);
    expect(view.recap.myPassedIn).toEqual(sent);
    expect(view.recap.myPassedOut).toEqual(returned);
    // The result action uses the same local /act driver as every learner move.
    expect(view.legal.canAdvanceHand).toBe(true);
    const next = applyAction(state, { type: 'next_hand', seat: 0 });
    expect(next).toMatchObject({
      phase: 'bidding', handNumber: 2, dealer: 1, turn: 2, rev: state.rev + 1,
      score: state.score, history: state.history,
    });
    expect(next.players.map(player => player.hand.length)).toEqual([12, 12, 12, 12]);
    expect(next.players.flatMap(player => player.hand).sort()).toEqual(buildDeck().sort());
    expect(next.players.map(player => player.hand)).not.toEqual(dealt);
    expect(next.bids).toEqual([]);
    expect(viewFor(next, 0).recap.myPassedIn).toEqual([]);
    expect(viewFor(next, 0).recap.myPassedOut).toEqual([]);
    expect(viewFor(next, 0).legal.canAdvanceHand).toBe(false);
    expect(newPracticeGame().players.map(player => player.hand)).toEqual(dealt);
    expect(newPracticeGame().history).toEqual([]);
  });

  it('restarts with detached state, including after a different bidding choice', () => {
    const initial = newPracticeGame();
    const saved = structuredClone(initial);
    let state = initial;
    for (const seat of [1, 2, 3, 0] as const) state = applyAction(state, { type: 'pass_bid', seat });
    expect(state).toMatchObject({ phase: 'declaring_trump', bidder: 0, highBid: { amount: 25 } });
    expect(initial).toEqual(saved);
    initial.players[0].hand.pop();
    initial.rules.minBid = 10;
    expect(newPracticeGame()).toEqual(saved);
  });

  it('leaves ordinary games dependent on their own seed', () => {
    const first = newGame('multiplayer-one');
    const second = newGame('multiplayer-two');
    expect(first).toEqual(newGame('multiplayer-one'));
    expect(first.players.map(player => player.hand)).not.toEqual(second.players.map(player => player.hand));
    expect(first.players.map(player => player.hand)).not.toEqual(dealt);
  });
});
