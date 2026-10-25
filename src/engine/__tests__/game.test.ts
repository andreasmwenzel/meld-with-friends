import { describe, expect, it } from 'vitest';
import {
  applyAction, buildDeck, DEFAULT_RULES, normaliseHandRecord, IllegalAction, legalActionsFor, newGame, viewFor,
} from '../index';
import type { Action, CardId, GameState, HandRecord, RulesConfig, SeatIndex, Team } from '../types';

const seats: readonly SeatIndex[] = [0, 1, 2, 3];
const teamOf = (seat: SeatIndex): Team => seat % 2 === 0 ? 'red' : 'blue';
function auction(rules: Partial<RulesConfig> = {}, bid = 250): GameState {
  let state = newGame('scripted-hand', rules);
  state = applyAction(state, { type: 'bid', seat: 1, amount: bid });
  for (const seat of [2, 3, 0] as const) state = applyAction(state, { type: 'pass_bid', seat });
  return applyAction(state, { type: 'declare_trump', seat: 1, suit: 'S' });
}
function startPlaying(rules: Partial<RulesConfig> = {}, bid = 250): GameState {
  let state = auction(rules, bid);
  for (let i = 0; i < 2 && state.phase.startsWith('passing'); i++) {
    const seat = state.turn!;
    state = applyAction(state, { type: 'pass_cards', seat, cards: state.players[seat].hand.slice(0, state.rules.passCount) });
  }
  for (const seat of seats) {
    state = applyAction(state, { type: 'declare_meld', seat, cards: state.players[seat].hand });
    state = applyAction(state, { type: 'confirm_meld', seat });
  }
  return state;
}
function playHand(initial: GameState): GameState {
  let state = initial;
  for (let i = 0; i < 48; i++) {
    const seat = state.turn!;
    const card = legalActionsFor(state, seat).playableCards[0];
    expect(card).toBeDefined();
    state = applyAction(state, { type: 'play_card', seat, card });
  }
  return state;
}
function expectBreakdown(record: HandRecord): void {
  for (const team of ['red', 'blue'] as const) {
    const b = record.breakdown[team];
    expect(b.meldDeclared).toBe(record.meld[team]);
    expect(record.delta[team]).toBe(b.meldSaved + b.counters + b.lastTrick - b.setPenalty + b.shoot);
  }
}
function frozen<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) frozen(child);
  }
  return value;
}

describe('game flow', () => {
  it('deals deterministic unique hands, with left of dealer opening', () => {
    const state = newGame('deal', {}, 2);
    expect(state).toEqual(newGame('deal', {}, 2));
    expect(state.turn).toBe(3);
    expect(state.phase).toBe('bidding');
    expect(state.players.map(p => p.hand.length)).toEqual([12, 12, 12, 12]);
    expect(state.players.flatMap(p => p.hand).sort()).toEqual(buildDeck().sort());
  });
  it('keeps passes final, skips passed seats, and awards the remaining bid', () => {
    let state = newGame('auction');
    state = applyAction(state, { type: 'bid', seat: 1, amount: 250 });
    state = applyAction(state, { type: 'pass_bid', seat: 2 });
    state = applyAction(state, { type: 'bid', seat: 3, amount: 260 });
    state = applyAction(state, { type: 'pass_bid', seat: 0 });
    state = applyAction(state, { type: 'bid', seat: 1, amount: 270 });
    expect(state.turn).toBe(3);
    expect(legalActionsFor(state, 2).canBid).toBe(false);
    state = applyAction(state, { type: 'pass_bid', seat: 3 });
    expect(state).toMatchObject({ phase: 'declaring_trump', bidder: 1, turn: 1, highBid: { amount: 270 } });
  });
  it('sticks the dealer when all pass, or redeals if configured', () => {
    for (const stuck of [true, false]) {
      let state = newGame('passed', { dealerStuck: stuck });
      const originalHands = state.players.map(player => player.hand);
      for (const seat of [1, 2, 3, 0] as const) state = applyAction(state, { type: 'pass_bid', seat });
      if (stuck) expect(state).toMatchObject({ phase: 'declaring_trump', bidder: 0, highBid: { amount: 250 } });
      else {
        expect(state.history).toEqual([]);
        expect(state).toMatchObject({ phase: 'bidding', dealer: 1, turn: 2, handNumber: 2, bids: [], highBid: null });
        expect(state.players.map(player => player.hand)).not.toEqual(originalHands);
        expect(state.players.flatMap(player => player.hand).sort()).toEqual(buildDeck().sort());
      }
    }
  });
  it('handles passing atomically, allows passing received cards back, and skips when disabled', () => {
    let state = auction();
    const cards = state.players[3].hand.slice(0, 4);
    state = applyAction(state, { type: 'pass_cards', seat: 3, cards });
    expect(state.phase).toBe('passing_back');
    expect(state.players.map(p => p.hand.length)).toEqual([12, 16, 12, 8]);
    expect(viewFor(state, 0).log.join(' ')).not.toContain(cards[0]);
    state = applyAction(state, { type: 'pass_cards', seat: 1, cards });
    expect(state.phase).toBe('melding');
    expect(state.players.map(p => p.hand.length)).toEqual([12, 12, 12, 12]);
    expect(state.players.flatMap(p => p.hand).sort()).toEqual(buildDeck().sort());
    expect(auction({ passCount: 0 }).phase).toBe('melding');
  });
  it('replaces meld declarations, locks confirmed meld, and waits for every seat', () => {
    let state = auction({ passCount: 0 });
    state = applyAction(state, { type: 'declare_meld', seat: 0, cards: state.players[0].hand });
    state = applyAction(state, { type: 'declare_meld', seat: 0, cards: [] });
    expect(state.players[0]).toMatchObject({ meld: [], meldPoints: 0 });
    for (const seat of [0, 1, 2] as const) state = applyAction(state, { type: 'confirm_meld', seat });
    expect(state.phase).toBe('melding');
    expect(() => applyAction(state, { type: 'declare_meld', seat: 0, cards: [] })).toThrow(IllegalAction);
    state = applyAction(state, { type: 'confirm_meld', seat: 3 });
    expect(state).toMatchObject({ phase: 'playing', turn: 1, currentTrick: { leader: 1, plays: [] } });
    expect(state.players.every(p => p.hand.length === 12)).toBe(true);
  });
  it('plays all 12 tricks, accounts for 250 counter points, and rotates the next dealer', () => {
    const state = playHand(startPlaying());
    expect(state.phase).toBe('hand_over');
    expect(state.tricksTaken.red.length + state.tricksTaken.blue.length).toBe(12);
    expect(state.tricksTaken.red.flat().concat(state.tricksTaken.blue.flat()).sort()).toEqual(buildDeck().sort());
    const record = state.history[0];
    expect(record.tricks.red + record.tricks.blue).toBe(250);
    const lastWinner = viewFor(state, 0).lastTrick!.winner!;
    for (const team of ['red', 'blue'] as const) {
      const raw = state.tricksTaken[team].flat().filter(c => ['A', 'T', 'K'].includes(c[0])).length * 10;
      expect(record.tricks[team]).toBe(raw + (teamOf(lastWinner) === team ? 10 : 0));
    }
    const next = applyAction(state, { type: 'next_hand', seat: 3 });
    expect(next).toMatchObject({ dealer: 1, turn: 2, phase: 'bidding', handNumber: 2 });
    expect(next.score).toEqual(state.score);
    expect(next.history).toEqual(state.history);
    expect(viewFor(next, 0).lastTrick).toBeNull();
    expect(next.players.map(p => p.hand.length)).toEqual([12, 12, 12, 12]);
  });
  it('goes set by the full bid, allowing negative scores', () => {
    const state = playHand(startPlaying({}, 10000));
    expect(state.history[0]).toMatchObject({ wentSet: true, delta: { blue: -10000 } });
    expect(state.score.blue).toBe(-10000);
    expectBreakdown(state.history[0]);
    expect(state.history[0].breakdown.blue).toMatchObject({ meldSaved: 0, counters: 0, lastTrick: 0, setPenalty: 10000, shoot: 0 });
  });
  it('scores a made contract, with bidding team winning ties at target', () => {
    let initial = startPlaying({ minBid: 10, target: 1 }, 10);
    initial = { ...initial, score: { red: 100, blue: 100 } };
    const state = playHand(initial);
    expect(state.history[0].wentSet).toBe(false);
    expectBreakdown(state.history[0]);
    expect(state.history[0].breakdown.blue.setPenalty).toBe(0);
    expect(state.phase).toBe('game_over');
    expect(state.winner).toBe('blue');
    expect(state.score.red).toBeGreaterThanOrEqual(1);
    expect(state.score.blue).toBeGreaterThanOrEqual(1);
    expect(() => applyAction(state, { type: 'next_hand', seat: 0 })).toThrow(IllegalAction);
  });
  it('lets the defenders win the game when the bidding side goes set', () => {
    const state = playHand(startPlaying({ target: 1 }, 10000));
    expect(state).toMatchObject({ phase: 'game_over', winner: 'red' });
  });
  it('uses configured counter values and last-trick bonuses', () => {
    const state = playHand(startPlaying({ counterValue: 2, lastTrickBonus: 7 }));
    expect(state.history[0].tricks.red + state.history[0].tricks.blue).toBe(55);
  });
  it.each([0, 10, 37])('counts classic cards as 240 points plus a last-trick bonus of %i', lastTrickBonus => {
    const state = playHand(startPlaying({ counting: 'classic', counterValue: 2, lastTrickBonus }));
    const record = state.history[0];
    expect(record.tricks.red + record.tricks.blue).toBe(240 + lastTrickBonus);
    const lastWinner = viewFor(state, 0).lastTrick!.winner!;
    for (const team of ['red', 'blue'] as const) {
      const cards = state.tricksTaken[team].flat();
      const raw = cards.filter(card => card[0] === 'A').length * 11
        + cards.filter(card => card[0] === 'T').length * 10
        + cards.filter(card => card[0] === 'K').length * 4
        + cards.filter(card => card[0] === 'Q').length * 3
        + cards.filter(card => card[0] === 'J').length * 2;
      expect(record.tricks[team]).toBe(raw + (teamOf(lastWinner) === team ? lastTrickBonus : 0));
    }
  });
  it('requires a trick to save meld on both sides, and honors disabling that rule', () => {
    for (const mustSave of [true, false]) for (const bidder of [0, 1] as const) {
      let state = startPlaying({ passCount: 0, mustTakeTrickToSaveMeld: mustSave });
      state.bidder = bidder;
      state.highBid = { seat: bidder, amount: 250 };
      state.currentTrick = { leader: 0, plays: [], winner: null };
      state.turn = 0;
      const finalCards: CardId[] = ['AS0', '9H0', '9C0', '9D0'];
      const captured = buildDeck().filter(card => !finalCards.includes(card));
      state.tricksTaken = { red: Array.from({ length: 11 }, (_, i) => captured.slice(i * 4, i * 4 + 4)), blue: [] };
      for (const seat of seats) {
        state.players[seat].hand = [finalCards[seat]];
        state.players[seat].meld = [];
        state.players[seat].meldPoints = 0;
      }
      state.players[1].meld = [{ kind: 'double_pinochle', cards: ['QS0', 'QS1', 'JD0', 'JD1'], points: 300 }];
      state.players[1].meldPoints = 300;
      for (const seat of seats) state = applyAction(state, { type: 'play_card', seat, card: finalCards[seat] });
      expect(state.history[0].tricks).toEqual({ red: 250, blue: 0 });
      expect(state.tricksTaken.blue).toHaveLength(0);
      expect(state.history[0].meld.blue).toBe(300);
      expect(state.score.red).toBe(250);
      expect(state.score.blue).toBe(mustSave ? bidder === 1 ? -250 : 0 : 300);
      expect(state.history[0].wentSet).toBe(mustSave && bidder === 1);
      expectBreakdown(state.history[0]);
      expect(state.history[0].breakdown.blue.meldSaved).toBe(mustSave ? 0 : 300);
      expect(state.history[0].breakdown.red).toMatchObject({ counters: 240, lastTrick: 10 });
    }
  });
  it('retains the previous trick through the next trick and JSON persistence', () => {
    let state = startPlaying();
    for (let i = 0; i < 4; i++) {
      const seat = state.turn!;
      state = applyAction(state, { type: 'play_card', seat, card: legalActionsFor(state, seat).playableCards[0] });
    }
    const last = viewFor(state, 0).lastTrick;
    expect(last?.plays).toHaveLength(4);
    expect(state.currentTrick?.leader).toBe(last?.winner);
    const seat = state.turn!;
    state = applyAction(JSON.parse(JSON.stringify(state)) as GameState, { type: 'play_card', seat, card: legalActionsFor(state, seat).playableCards[0] });
    expect(viewFor(state, 0).lastTrick).toEqual(last);
  });
  it('never mutates input state, nested cards, or caller-owned actions', () => {
    const initial = frozen(newGame('immutable'));
    const snapshot = JSON.stringify(initial);
    const state = applyAction(initial, frozen({ type: 'bid', seat: 1, amount: 250 } as const));
    expect(state.rev).toBe(1);
    expect(JSON.stringify(initial)).toBe(snapshot);
    let playing = frozen(startPlaying());
    for (let i = 0; i < 48; i++) {
      const seat = playing.turn!;
      const next = applyAction(playing, { type: 'play_card', seat, card: legalActionsFor(playing, seat).playableCards[0] });
      playing = frozen(next);
    }
    expect(playing.phase).toBe('hand_over');
    expect(playing.log.length).toBeLessThanOrEqual(50);
  });
});

describe('validation and visibility', () => {
  it('merges partial rules with defaults and rejects invalid counting modes', () => {
    expect(newGame('defaults').rules).toEqual(DEFAULT_RULES);
    expect(newGame('classic', { counting: 'classic' }).rules).toEqual({ ...DEFAULT_RULES, counting: 'classic' });
    for (const counting of ['invalid', '', true, null, undefined]) {
      expect(() => newGame('bad', { counting } as unknown as Partial<RulesConfig>)).toThrow(IllegalAction);
    }
  });
  it('throws IllegalAction on illegal bids, turns, phases, and malformed card selections', () => {
    const state = newGame('illegal');
    const bad: Action[] = [
      { type: 'bid', seat: 0, amount: 250 }, { type: 'bid', seat: 1, amount: 240 },
      { type: 'bid', seat: 1, amount: 255 }, { type: 'bid', seat: 1, amount: NaN },
      { type: 'declare_trump', seat: 1, suit: 'S' }, { type: 'play_card', seat: 1, card: 'AS0' },
      { type: 'next_hand', seat: 0 },
    ];
    for (const action of bad) expect(() => applyAction(state, action)).toThrow(IllegalAction);
    const passing = auction();
    const cards = passing.players[3].hand;
    expect(() => applyAction(passing, { type: 'pass_cards', seat: 3, cards: cards.slice(0, 3) })).toThrow('exactly 4');
    expect(() => applyAction(passing, { type: 'pass_cards', seat: 3, cards: [cards[0], cards[0], cards[1], cards[2]] })).toThrow('twice');
    expect(() => applyAction(passing, { type: 'pass_cards', seat: 3, cards: passing.players[0].hand.slice(0, 4) })).toThrow('in your hand');
    const playing = startPlaying();
    expect(() => applyAction(playing, { type: 'play_card', seat: 1, card: playing.players[0].hand[0] })).toThrow(IllegalAction);
    expect(() => newGame('bad', { passCount: 13 })).toThrow(IllegalAction);
  });
  it('rejects a card that fails the obligation to follow or head the trick', () => {
    const state = startPlaying();
    // Use a known valid distribution to exercise the public action boundary.
    state.currentTrick = { leader: 0, plays: [{ seat: 0, card: 'QH0' }], winner: null };
    state.turn = 1;
    state.players[1].hand = ['AH0', '9H0', 'AS0'];
    expect(() => applyAction(state, { type: 'play_card', seat: 1, card: '9H0' })).toThrow(IllegalAction);
    expect(() => applyAction(state, { type: 'play_card', seat: 1, card: 'AS0' })).toThrow(IllegalAction);
  });
  it('hides all other hands and pass buffers, exposes public meld, and returns detached data', () => {
    let state = auction({ passCount: 0 });
    state = applyAction(state, { type: 'declare_meld', seat: 2, cards: state.players[2].hand });
    state.players[3].passBuffer = ['AS0'];
    const view = viewFor(state, 0);
    expect(view.hand).toEqual(state.players[0].hand);
    expect(view.handCounts).toEqual([12, 12, 12, 12]);
    expect(view.melds[2]).toEqual(state.players[2].meld);
    expect(view).not.toHaveProperty('players');
    expect(view).not.toHaveProperty('passBuffer');
    expect(view).not.toHaveProperty('seed');
    expect(JSON.stringify(view)).not.toContain('passBuffer');
    view.hand.pop();
    view.rules.target = 999;
    view.melds[2].splice(0);
    expect(state.players[0].hand).toHaveLength(12);
    expect(state.rules.target).toBe(1500);
    expect(viewFor(state, 0).melds[2]).toEqual(state.players[2].meld);
  });
});


describe('completed hand reveals', () => {
  it('hides snapshots until hand over, preserves both hands through JSON, and resets on the next deal', () => {
    const dealt = newGame('scripted-hand').players.map(player => [...player.hand]);
    const playing = startPlaying();
    const atPlay = playing.players.map(player => [...player.hand]);
    for (const state of [newGame('scripted-hand'), auction(), playing]) {
      for (const seat of seats) {
        expect(viewFor(state, seat).revealed).toBeNull();
        expect(viewFor(state, seat)).not.toHaveProperty('handsDealt');
        expect(viewFor(state, seat)).not.toHaveProperty('handsAtPlay');
      }
    }
    const ended = playHand(JSON.parse(JSON.stringify(playing)) as GameState);
    expect(ended.phase).toBe('hand_over');
    for (const seat of seats) {
      const revealed = viewFor(ended, seat).revealed!;
      for (const owner of seats) {
        expect(revealed.dealt[owner]).toEqual(dealt[owner]);
        expect(revealed.atPlay[owner]).toEqual(atPlay[owner]);
        expect(revealed.dealt[owner]).toHaveLength(12);
        expect(revealed.atPlay[owner]).toHaveLength(12);
      }
      for (const owner of [1, 3] as const) {
        expect([...revealed.atPlay[owner]].sort()).not.toEqual([...revealed.dealt[owner]].sort());
      }
      revealed.dealt[0].pop();
      revealed.atPlay[0].pop();
      expect(viewFor(ended, seat).revealed!.atPlay[0]).toHaveLength(12);
      expect(viewFor(ended, seat).revealed!.dealt[0]).toHaveLength(12);
    }
    const next = applyAction(ended, { type: 'next_hand', seat: 0 });
    expect(viewFor(next, 0).revealed).toBeNull();
    const nextEnded = playHand(startPlaying({ passCount: 0 }));
    expect(nextEnded.phase).toBe('hand_over');
    expect(viewFor(nextEnded, 0).revealed!.dealt).toEqual(viewFor(nextEnded, 0).revealed!.atPlay);
  });

  it('reveals at game over and honors disabling the rule', () => {
    const ended = playHand(startPlaying({ target: 1 }));
    expect(ended.phase).toBe('game_over');
    expect(viewFor(ended, 0).revealed!.atPlay[0]).toHaveLength(12);
    for (const target of [1, 1500]) {
      expect(viewFor(playHand(startPlaying({ revealHands: false, target })), 0).revealed).toBeNull();
    }
  });

  it('treats missing snapshots in older stored games as empty hands', () => {
    const stored = JSON.parse(JSON.stringify(playHand(startPlaying())));
    delete stored.handsDealt;
    delete stored.handsAtPlay;
    const empty = { 0: [], 1: [], 2: [], 3: [] };
    expect(viewFor(stored as GameState, 0).revealed).toEqual({ dealt: empty, atPlay: empty });
  });
});


describe('score breakdown and stored history', () => {
  it('balances each team across 100 seeded hands with both counting and meld-saving rules', () => {
    for (let seed = 0; seed < 100; seed++) {
      let state = newGame(`breakdown:${seed}`, {
        passCount: 0, minBid: 10, target: 100000,
        counting: seed % 2 ? 'classic' : 'tens', mustTakeTrickToSaveMeld: seed % 4 < 2,
        lastTrickBonus: seed % 3 === 0 ? 37 : 10,
      });
      state = applyAction(state, { type: 'bid', seat: 1, amount: seed % 3 ? 10 : 10000 });
      for (const seat of [2, 3, 0] as const) state = applyAction(state, { type: 'pass_bid', seat });
      state = applyAction(state, { type: 'declare_trump', seat: 1, suit: ['S', 'H', 'D', 'C'][seed % 4] as 'S' | 'H' | 'D' | 'C' });
      for (const seat of seats) {
        state = applyAction(state, { type: 'declare_meld', seat, cards: state.players[seat].hand });
        state = applyAction(state, { type: 'confirm_meld', seat });
      }
      state = playHand(state);
      expectBreakdown(state.history[0]);
      const record = state.history[0];
      for (const team of ['red', 'blue'] as const) {
        const b = record.breakdown[team];
        if (!record.wentSet || team === 'red') expect(b.counters + b.lastTrick).toBe(record.tricks[team]);
      }
    }
  });

  it('normalises old JSON history without changing stored state or new records', () => {
    for (const bid of [10, 10000]) {
      const ended = playHand(startPlaying({ minBid: 10 }, bid));
      const record = ended.history[0];
      expect(normaliseHandRecord(record)).toEqual(record);
      const stored = JSON.parse(JSON.stringify(ended));
      delete stored.history[0].breakdown;
      const snapshot = JSON.stringify(stored);
      const restored = viewFor(stored as GameState, 0).history[0];
      expectBreakdown(restored);
      expect(restored.breakdown.blue.meldSaved).toBe(record.wentSet ? 0 : record.meld.blue);
      expect(restored.breakdown.blue.lastTrick).toBe(0);
      expect(JSON.stringify(stored)).toBe(snapshot);
    }
  });

  it('exposes constraints only to the active player during play', () => {
    expect(viewFor(newGame('constraints'), 1).legal.playConstraint).toBeNull();
    const state = startPlaying();
    expect(viewFor(state, state.turn!).legal.playConstraint).toEqual({ reason: 'lead_any', ledSuit: null, mustBeat: null });
    for (const seat of seats.filter(seat => seat !== state.turn)) expect(viewFor(state, seat).legal.playConstraint).toBeNull();
    state.currentTrick = { leader: 0, plays: [{ seat: 0, card: 'KH0' }], winner: null };
    state.turn = 1;
    state.players[1].hand = ['AH0', '9H0'];
    expect(viewFor(state, 1).legal).toMatchObject({ playableCards: ['AH0'], playConstraint: { reason: 'must_head', ledSuit: 'H', mustBeat: 'KH0' } });
    const ended = playHand(startPlaying());
    for (const seat of seats) expect(viewFor(ended, seat).legal.playConstraint).toBeNull();
  });
});
