import { describe, expect, it } from 'vitest';
import { applyAction, buildDeck, legalActionsFor, newGame, viewFor } from '../index';
import type { CardId, GameState, RulesConfig } from '../types';

const seats = [0, 1, 2, 3] as const;

function shooting(rules: Partial<RulesConfig>): GameState {
  let state = newGame('shoot', { passCount: 0, ...rules });
  state = applyAction(state, { type: 'shoot', seat: 1 });
  for (const seat of [2, 3, 0] as const) state = applyAction(state, { type: 'pass_bid', seat });
  state = applyAction(state, { type: 'declare_trump', seat: 1, suit: 'S' });
  for (const seat of seats) state = applyAction(state, { type: 'confirm_meld', seat });
  return state;
}

function resolveShot(mode: 'game' | 'points', made: boolean, mustSave = true): GameState {
  let state = shooting({ shoot: mode, shootPoints: 500, mustTakeTrickToSaveMeld: mustSave });
  const cards: CardId[] = made ? ['9D0', 'AS0', '9H0', '9C0'] : ['KH0', '9H0', 'AH0', 'TH0'];
  const remaining = buildDeck().filter(card => !cards.includes(card));
  for (const seat of seats) {
    state.players[seat].hand = [cards[seat], ...(made ? [] : remaining.slice(seat * 11, seat * 11 + 11))];
  }
  if (made) state.tricksTaken.blue = Array.from({ length: 11 }, (_, i) => remaining.slice(i * 4, i * 4 + 4));
  // The shooting side's meld must be recorded but cannot affect success or the stake.
  state.players[1].meldPoints = 1500;
  state.players[0].meldPoints = 40;
  for (const seat of [1, 2, 3, 0] as const) {
    state = applyAction(state, { type: 'play_card', seat, card: cards[seat] });
  }
  return state;
}

describe('shooting the moon', () => {
  it('requires an enabled rule and the active bidding seat', () => {
    const disabled = newGame('disabled');
    expect(legalActionsFor(disabled, 1).canShoot).toBe(false);
    expect(() => applyAction(disabled, { type: 'shoot', seat: 1 })).toThrow();
    const enabled = newGame('enabled', { shoot: 'game' });
    expect(legalActionsFor(enabled, 1).canShoot).toBe(true);
    expect(() => applyAction(enabled, { type: 'shoot', seat: 0 })).toThrow();
    expect(() => applyAction(shooting({ shoot: 'game' }), { type: 'shoot', seat: 1 })).toThrow();
  });

  it.each(['points', 'game'] as const)('computes the %s stake and permits only passes after a shoot', shoot => {
    let state = newGame('auction', { shoot, shootPoints: 500, target: 2000 });
    state = applyAction(state, { type: 'pass_bid', seat: 1 });
    state = applyAction(state, { type: 'shoot', seat: 2 });
    expect(state.highBid).toEqual({ seat: 2, amount: shoot === 'game' ? 2000 : 500, shoot: true });
    expect(state.log.at(-1)).toBe('North shoots the moon');
    expect(legalActionsFor(state, 3)).toMatchObject({ canBid: false, minBid: null, canPassBid: true, canShoot: false });
    expect(() => applyAction(state, { type: 'bid', seat: 3, amount: 3000 })).toThrow();
    expect(() => applyAction(state, { type: 'shoot', seat: 3 })).toThrow();
    state = applyAction(state, { type: 'pass_bid', seat: 3 });
    state = applyAction(state, { type: 'pass_bid', seat: 0 });
    expect(state).toMatchObject({ phase: 'declaring_trump', bidder: 2, turn: 2 });
    expect(legalActionsFor(state, 1).canPassBid).toBe(false);
  });

  it('preserves trump declaration, passing, and melding after shooting', () => {
    let state = newGame('passing', { shoot: 'game' });
    state = applyAction(state, { type: 'shoot', seat: 1 });
    for (const seat of [2, 3, 0] as const) state = applyAction(state, { type: 'pass_bid', seat });
    state = applyAction(state, { type: 'declare_trump', seat: 1, suit: 'S' });
    expect(state.phase).toBe('passing_to_bidder');
    for (const seat of [3, 1] as const) {
      state = applyAction(state, { type: 'pass_cards', seat, cards: state.players[seat].hand.slice(0, 4) });
    }
    expect(state.phase).toBe('melding');
  });

  it.each([true, false])('resolves a game shoot with made=%s', made => {
    const state = resolveShot('game', made);
    const winner = made ? 'blue' : 'red';
    expect(state).toMatchObject({ phase: 'game_over', winner, turn: null, currentTrick: null });
    expect(state.score[winner]).toBe(1500);
    expect(state.history[0]).toMatchObject({ bid: 1500, shotMade: made, wentSet: !made, meld: { red: 40, blue: 1500 } });
    expect(state.history[0].delta).toEqual(made ? { red: 0, blue: 1500 } : { red: 1500, blue: 0 });
    expect(state.tricksTaken.blue.length + state.tricksTaken.red.length).toBe(made ? 12 : 1);
    expect(state.players.every(player => player.hand.length === 11)).toBe(!made);
  });

  it('plays a made shoot through all twelve tricks and preserves scores already above target', () => {
    let state = shooting({ shoot: 'game' });
    const blue = buildDeck().filter(card => card[1] === 'S' || card[1] === 'H');
    const red = buildDeck().filter(card => card[1] === 'D' || card[1] === 'C');
    state.players[0].hand = red.slice(0, 12);
    state.players[2].hand = red.slice(12);
    state.players[1].hand = blue.slice(0, 12);
    state.players[3].hand = blue.slice(12);
    state.score = { red: 100, blue: 2000 };
    for (let i = 0; i < 48; i++) {
      expect(state.phase).toBe('playing');
      const seat = state.turn!;
      state = applyAction(state, { type: 'play_card', seat, card: legalActionsFor(state, seat).playableCards[0] });
    }
    expect(state).toMatchObject({ phase: 'game_over', winner: 'blue', score: { red: 100, blue: 2000 } });
    expect(state.tricksTaken.blue).toHaveLength(12);
    expect(state.history[0]).toMatchObject({ shotMade: true, delta: { red: 0, blue: 0 },
      breakdown: { red: { shoot: 0 }, blue: { shoot: 0, counters: 0, lastTrick: 0, meldSaved: 0 } } });
  });

  it.each([true, false])('applies the points stake with made=%s and scores defenders normally', made => {
    const state = resolveShot('points', made);
    expect(state.phase).toBe('hand_over');
    expect(state.score).toEqual({ blue: made ? 500 : -500, red: made ? 0 : 70 });
    expect(state.history[0]).toMatchObject({ bid: 500, shotMade: made, wentSet: !made });
    // Losing the first trick does not award the last-trick bonus.
    expect(state.history[0].tricks.red).toBe(made ? 0 : 30);
    expect(resolveShot('points', made, false).score.red).toBe(made ? 40 : 70);
  });

  it.each([
    ['game', true, true], ['game', true, false], ['game', false, true], ['game', false, false],
    ['points', true, true], ['points', true, false], ['points', false, true], ['points', false, false],
  ] as const)('balances %s shoot, made=%s, must save meld=%s', (mode, made, mustSave) => {
    const state = resolveShot(mode, made, mustSave);
    const record = state.history[0];
    for (const team of ['red', 'blue'] as const) {
      const b = record.breakdown[team];
      expect(record.delta[team]).toBe(b.meldSaved + b.counters + b.lastTrick - b.setPenalty + b.shoot);
      expect(b.meldDeclared).toBe(record.meld[team]);
      expect(b.setPenalty).toBe(0);
    }
    expect(record.breakdown.blue).toMatchObject({ meldSaved: 0, counters: 0, lastTrick: 0,
      shoot: mode === 'points' ? made ? 500 : -500 : made ? 1500 : 0 });
    expect(record.breakdown.red).toMatchObject(mode === 'game'
      ? { meldSaved: 0, counters: 0, lastTrick: 0, shoot: made ? 0 : 1500 }
      : { meldSaved: made && mustSave ? 0 : 40, counters: made ? 0 : 30, lastTrick: 0, shoot: 0 });
    const stored = JSON.parse(JSON.stringify(state));
    delete stored.history[0].breakdown;
    const restored = viewFor(stored, 0).history[0];
    for (const team of ['red', 'blue'] as const) {
      const b = restored.breakdown[team];
      expect(restored.delta[team]).toBe(b.meldSaved + b.counters + b.lastTrick - b.setPenalty + b.shoot);
    }
  });

  it('validates shoot rules', () => {
    expect(() => newGame('bad', { shoot: 'invalid' } as unknown as Partial<RulesConfig>)).toThrow();
    for (const shootPoints of [0, -10, 1.5, NaN]) {
      expect(() => newGame('bad', { shootPoints })).toThrow();
    }
  });
});
