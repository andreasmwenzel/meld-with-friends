import { describe, expect, it } from 'vitest';
import { IllegalAction } from '../../types';
import {
  applyHeartsAction, buildHeartsDeck, cardPoints, chooseHeartsAction, DEFAULT_HEARTS_RULES,
  HEARTS_RANKS, heartsCardLabel, heartsViewFor, isPenaltyCard, legalPlays, newHeartsGame,
  parseHeartsCard, playReason, rankValue, resolveHeartsRules, sortHeartsHand,
} from '..';
import type { HeartsAction, HeartsCardId, HeartsRules, HeartsState, SeatIndex } from '..';

const seats = [0, 1, 2, 3] as const;
const clone = <T>(value: T): T => structuredClone(value);
function frozen<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(frozen); Object.freeze(value); }
  return value;
}
function position(hand: HeartsCardId[], plays: HeartsCardId[] = [], first = false): HeartsState {
  const state = newHeartsGame('position', { passing: 'none' });
  state.turn = 0;
  state.players[0].hand = hand;
  state.currentTrick = { leader: plays.length ? 3 : 0, plays: plays.map(card => ({ seat: 3, card })), winner: null };
  if (!first) state.tricks = [{ leader: 0, plays: [], winner: 0 }];
  return state;
}
function finish(state: HeartsState): HeartsState {
  let next = state;
  for (let steps = 0; next.phase === 'passing' || next.phase === 'playing'; steps++) {
    if (steps > 60) throw new Error('Hand did not finish');
    const seat = next.phase === 'passing' ? next.players.find(p => !p.passed)!.seat : next.turn!;
    next = applyHeartsAction(next, chooseHeartsAction(heartsViewFor(next, seat), `finish:${steps}`));
  }
  return next;
}
/** A final trick with all other cards already accounted for in public taken piles. */
function ending(rules: Partial<HeartsRules>, allocations: Partial<Record<HeartsCardId, SeatIndex>>, fallback: SeatIndex = 0): HeartsState {
  const state = newHeartsGame('ending', { passing: 'none', target: 10000, ...rules });
  const final: HeartsCardId[] = ['2C', '3C', '4C', 'AC'];
  state.players.forEach((p, i) => { p.hand = [final[i]]; p.taken = []; });
  for (const card of buildHeartsDeck().filter(c => !final.includes(c))) state.players[allocations[card] ?? fallback].taken.push(card);
  state.tricks = Array.from({ length: 12 }, () => ({ leader: 0, plays: [], winner: 0 }));
  state.currentTrick = { leader: 0, plays: [], winner: null };
  state.turn = 0;
  return state;
}

describe('Hearts deck and deals', () => {
  it('builds all 52 unique cards and validates IDs', () => {
    const deck = buildHeartsDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(deck).size).toBe(52);
    expect(HEARTS_RANKS.map(rankValue)).toEqual(Array.from({ length: 13 }, (_, i) => i + 2));
    expect(parseHeartsCard('TH')).toEqual({ rank: 'T', suit: 'H' });
    for (const bad of ['10H', 'AS0', '1C', '2X', '', '2C\n']) expect(() => parseHeartsCard(bad as HeartsCardId)).toThrow();
    expect(heartsCardLabel('TH')).toBe('10♥');
    expect(heartsCardLabel('QS')).toBe('Q♠');
  });
  it('sorts a copy in clubs, diamonds, spades, hearts order', () => {
    const hand: HeartsCardId[] = ['AH', 'KS', '2C', 'AD', '2S', '3H', 'AC'];
    expect(sortHeartsHand(frozen(hand))).toEqual(['2C', 'AC', 'AD', '2S', 'KS', '3H', 'AH']);
    expect(hand[0]).toBe('AH');
  });
  it('scores penalties and the optional bonus separately', () => {
    expect(cardPoints('QS', DEFAULT_HEARTS_RULES)).toBe(13);
    expect(cardPoints('AH', DEFAULT_HEARTS_RULES)).toBe(1);
    expect(cardPoints('JD', DEFAULT_HEARTS_RULES)).toBe(0);
    expect(cardPoints('JD', { ...DEFAULT_HEARTS_RULES, jackOfDiamonds: true })).toBe(-10);
    expect(isPenaltyCard('JD', { ...DEFAULT_HEARTS_RULES, jackOfDiamonds: true })).toBe(false);
  });
  it('normalizes bad rule values, dropping unknown keys', () => {
    expect(resolveHeartsRules({ target: NaN, pace: 'bad', passing: 42, moon: null, jackOfDiamonds: 1, noPointsFirstTrick: 'yes', extra: true } as unknown as HeartsRules)).toEqual(DEFAULT_HEARTS_RULES);
    for (const target of [0, -1, Infinity, 1.5]) expect(resolveHeartsRules({ target }).target).toBe(100);
    expect(resolveHeartsRules({ target: 50, pace: 'leisurely', noPointsFirstTrick: false })).toMatchObject({ target: 50, pace: 'leisurely', noPointsFirstTrick: false });
  });
  it('deals 13 each deterministically, clockwise after the dealer', () => {
    const state = newHeartsGame('deal');
    expect(state).toEqual(newHeartsGame('deal'));
    expect(state.players.map(p => p.hand.length)).toEqual([13, 13, 13, 13]);
    expect(state.players.flatMap(p => p.hand).sort()).toEqual(buildHeartsDeck().sort());
    expect(state.players).not.toEqual(newHeartsGame('different').players);
    const rotated = newHeartsGame('deal', {}, 1);
    for (const seat of seats) expect(rotated.players[((seat + 1) % 4) as SeatIndex].hand).toEqual(state.players[seat].hand);
    expect(state).toMatchObject({ handNumber: 1, rev: 0, phase: 'passing', turn: null });
  });
  it('cycles left, right, across, hold and rotates the dealer on next_hand', () => {
    for (const passing of ['rotate', 'none'] as const) {
      let state = newHeartsGame('rotation', { passing, target: 100000 });
      for (let hand = 1; hand <= 5; hand++) {
        expect(state.pass).toBe(passing === 'none' ? 'hold' : ['left', 'right', 'across', 'hold', 'left'][hand - 1]);
        expect(state.phase).toBe(state.pass === 'hold' ? 'playing' : 'passing');
        if (state.pass === 'hold') expect(state.players[state.turn!].hand).toContain('2C');
        const ended = finish(state);
        const next = applyHeartsAction(ended, { type: 'next_hand', seat: 2 });
        expect(next.dealer).toBe((state.dealer + 1) % 4);
        expect(next.history).toEqual(ended.history);
        expect(next.score).toEqual(ended.score);
        expect(next.rev).toBe(ended.rev + 1);
        expect(next.lastTrick).toBeNull();
        expect(next.handNumber).toBe(hand + 1);
        state = next;
      }
    }
  });
});

describe('passing and legality', () => {
  it.each([['left', 1], ['right', 3], ['across', 2]] as const)('moves a %s pass atomically to the right seat', (direction, offset) => {
    let state = newHeartsGame('pass');
    state.pass = direction;
    const cards = state.players.map(p => p.hand.slice(0, 3));
    const before = clone(state);
    for (const seat of seats) {
      const rev = state.rev;
      state = applyHeartsAction(frozen(state), frozen({ type: 'pass_cards', seat, cards: cards[seat] }));
      expect(state.rev).toBe(rev + 1);
      if (seat < 3) expect(state.phase).toBe('passing');
    }
    for (const seat of seats) {
      const recipient = ((seat + offset) % 4) as SeatIndex;
      expect(state.received[recipient]).toEqual(cards[seat]);
      for (const card of cards[seat]) expect(state.players[recipient].hand).toContain(card);
      expect(state.players[seat].passBuffer).toEqual([]);
    }
    expect(state.players.map(p => p.hand.length)).toEqual([13, 13, 13, 13]);
    expect(state.players.flatMap(p => p.hand).sort()).toEqual(buildHeartsDeck().sort());
    expect(before.players.every(p => p.hand.length === 13)).toBe(true);
    expect(state).toMatchObject({ phase: 'playing', heartsBroken: false });
    expect(legalPlays(state, state.turn!)).toEqual(['2C']);
    const turn = state.turn!;
    state = applyHeartsAction(state, { type: 'play_card', seat: turn, card: '2C' });
    expect(state.received[turn]).toEqual([]);
  });
  it('rejects bad phases, repeated passes, duplicates, absent cards, seats and unknown actions', () => {
    const state = newHeartsGame('illegal');
    const cards = state.players[0].hand.slice(0, 3);
    const actions: HeartsAction[] = [
      { type: 'next_hand', seat: 0 }, { type: 'play_card', seat: 0, card: cards[0] },
      { type: 'pass_cards', seat: 0, cards: cards.slice(0, 2) },
      { type: 'pass_cards', seat: 0, cards: [cards[0], cards[0], cards[1]] },
      { type: 'pass_cards', seat: 0, cards: state.players[1].hand.slice(0, 3) },
      { type: 'wat', seat: 0 } as unknown as HeartsAction,
      { type: 'next_hand', seat: 8 } as unknown as HeartsAction,
    ];
    for (const action of actions) expect(() => applyHeartsAction(state, action)).toThrow(IllegalAction);
    const passed = applyHeartsAction(state, { type: 'pass_cards', seat: 0, cards });
    expect(() => applyHeartsAction(passed, { type: 'pass_cards', seat: 0, cards })).toThrow(IllegalAction);
  });
  it('requires 2C to open and rejects out-of-turn play', () => {
    const state = newHeartsGame('open', { passing: 'none' });
    expect(playReason(state, state.turn!)).toBe('lead_two_clubs');
    expect(legalPlays(state, state.turn!)).toEqual(['2C']);
    expect(() => applyHeartsAction(state, { type: 'play_card', seat: state.turn!, card: state.players[state.turn!].hand.find(c => c !== '2C')! })).toThrow(IllegalAction);
    expect(legalPlays(state, ((state.turn! + 1) % 4) as SeatIndex)).toEqual([]);
  });
  it('enforces following suit and computes the highest led-suit winner', () => {
    let state = position(['2D', 'AH'], ['KD']);
    expect(legalPlays(state, 0)).toEqual(['2D']);
    expect(playReason(state, 0)).toBe('follow_suit');
    expect(() => applyHeartsAction(state, { type: 'play_card', seat: 0, card: 'AH' })).toThrow(IllegalAction);
    state.currentTrick = { leader: 0, plays: [], winner: null };
    state.players.forEach((p, i) => { p.hand = [(['2D', 'AD', 'AH', 'KD'] as HeartsCardId[])[i]]; });
    for (const seat of seats) state = applyHeartsAction(state, { type: 'play_card', seat, card: state.players[seat].hand[0] });
    expect(state.lastTrick!.winner).toBe(1);
    expect(state.turn).toBe(1);
    expect(state.players[1].taken).toEqual(['2D', 'AD', 'AH', 'KD']);
  });
  it('restricts heart leads until broken, with an all-hearts exception', () => {
    const state = position(['2H', 'QS', '3D']);
    expect(legalPlays(state, 0)).toEqual(['QS', '3D']);
    expect(playReason(state, 0)).toBe('hearts_not_broken');
    state.heartsBroken = true;
    expect(legalPlays(state, 0)).toEqual(state.players[0].hand);
    expect(legalPlays(position(['2H', 'AH']), 0)).toEqual(['2H', 'AH']);
  });
  it('breaks hearts on an off-suit heart, but not the queen', () => {
    for (const card of ['AH', 'QS'] as const) {
      const state = position([card], ['2D']);
      expect(applyHeartsAction(state, { type: 'play_card', seat: 0, card }).heartsBroken).toBe(card === 'AH');
    }
  });
  it('bars first-trick penalties unless the whole hand is penalties; allows JD', () => {
    const state = position(['QS', 'AH', 'JD'], ['2C'], true);
    expect(legalPlays(state, 0)).toEqual(['JD']);
    expect(playReason(state, 0)).toBe('no_points_first_trick');
    expect(() => applyHeartsAction(state, { type: 'play_card', seat: 0, card: 'AH' })).toThrow(IllegalAction);
    state.players[0].hand = ['QS', 'AH'];
    expect(legalPlays(state, 0)).toEqual(['QS', 'AH']);
    state.players[0].hand.push('3C');
    expect(legalPlays(state, 0)).toEqual(['3C']);
    state.players[0].hand = ['AH', 'JD'];
    state.rules.noPointsFirstTrick = false;
    expect(legalPlays(state, 0)).toEqual(['AH', 'JD']);
  });
});

describe('scoring and private views', () => {
  it('scores QS as 13 and JD as minus 10 at hand end', () => {
    for (const jackOfDiamonds of [false, true]) {
      const state = finish(ending({ jackOfDiamonds }, { QS: 1, JD: 2 }));
      expect(state.history[0].taken).toEqual({ 0: 13, 1: 13, 2: jackOfDiamonds ? -10 : 0, 3: 0 });
      expect(state.history[0].delta).toEqual(state.history[0].taken);
      expect(state.phase).toBe('hand_over');
      expect(state.lastTrick!.plays).toHaveLength(4);
      expect(state.turn).toBeNull();
    }
  });
  it.each(['add', 'subtract'] as const)('applies moon %s while preserving the jack bonus for its taker', moon => {
    for (const jackSeat of [0, 1] as const) {
      const state = finish(ending({ moon, jackOfDiamonds: true }, { JD: jackSeat }));
      const expected = moon === 'add' ? { 0: 0, 1: 26, 2: 26, 3: 26 } : { 0: -26, 1: 0, 2: 0, 3: 0 };
      expected[jackSeat] -= 10;
      expect(state.history[0].moon).toBe(0);
      expect(state.history[0].delta).toEqual(expected);
      expect(state.score).toEqual(expected);
      expect(state.log).toContain('South shot the moon');
    }
  });
  it('ends at target with the unique lowest score, but continues on a lowest tie', () => {
    const initial = ending({ target: 20 }, { QS: 1 });
    initial.score = { 0: 10, 1: 0, 2: 5, 3: 6 };
    const ended = finish(initial);
    expect(ended).toMatchObject({ phase: 'game_over', winner: 2 });
    expect(() => applyHeartsAction(ended, { type: 'next_hand', seat: 0 })).toThrow(IllegalAction);
    initial.score[3] = 5;
    const tied = finish(initial);
    expect(tied).toMatchObject({ phase: 'hand_over', winner: null });
    expect(applyHeartsAction(tied, { type: 'next_hand', seat: 3 }).handNumber).toBe(2);
  });
  it('hides other hands and buffers, exposes penalties, and detaches the entire view', () => {
    const state = ending({ jackOfDiamonds: true }, { QS: 1, JD: 2 });
    const view = heartsViewFor(state, 0);
    expect(view.handCounts).toEqual([1, 1, 1, 1]);
    expect(view.hand).toEqual(['2C']);
    expect(view).not.toHaveProperty('players');
    expect(view).not.toHaveProperty('seed');
    expect(view).not.toHaveProperty('passBuffer');
    expect(view.taken[0]).toEqual({ hearts: 13, queen: false, jack: false, points: 13 });
    expect(view.taken[1].points).toBe(13);
    expect(view.taken[2].points).toBe(-10);
    view.hand.pop(); view.rules.target = 1; view.score[0] = 999;
    expect(state.players[0].hand).toEqual(['2C']);
    expect(state.rules.target).toBe(10000);
    expect(state.score[0]).toBe(0);
    const passing = newHeartsGame('visibility');
    expect(heartsViewFor(passing, 0).legal.mustPassCount).toBe(3);
    const passed = applyHeartsAction(passing, { type: 'pass_cards', seat: 0, cards: passing.players[0].hand.slice(0, 3) });
    expect(heartsViewFor(passed, 0).legal.mustPassCount).toBeNull();
    expect(heartsViewFor(passed, 1).received).toEqual([]);
  });
  it('never mutates frozen state or actions and increments rev once per action', () => {
    let state = frozen(newHeartsGame('immutable', { passing: 'none' }));
    const snapshot = JSON.stringify(state);
    const initial = state;
    for (let i = 0; i < 52; i++) {
      const seat = state.turn!;
      const action = frozen(chooseHeartsAction(heartsViewFor(state, seat), 'immutable'));
      const next = applyHeartsAction(state, action);
      expect(next.rev).toBe(state.rev + 1);
      state = frozen(next);
    }
    expect(JSON.stringify(initial)).toBe(snapshot);
    expect(state.log.length).toBeLessThanOrEqual(50);
    const view = heartsViewFor(state, 0);
    expect(view.playedCards).toHaveLength(52);
    expect(Object.values(view.tricksTaken).reduce((a, b) => a + b, 0)).toBe(13);
    expect(view.legal.canAdvanceHand).toBe(state.phase === 'hand_over');
  });
});

describe('computer player', () => {
  it('is deterministic, returns only legal actions, and finishes 50 seeded games', () => {
    for (let seed = 0; seed < 50; seed++) {
      let state = newHeartsGame(`fuzz:${seed}`, { jackOfDiamonds: seed % 2 === 0, moon: seed % 3 ? 'add' : 'subtract' });
      let steps = 0;
      while (state.phase !== 'game_over') {
        if (++steps > 20000) throw new Error(`Game ${seed} did not finish`);
        const seat = state.phase === 'passing' ? state.players.find(p => !p.passed)!.seat : state.turn ?? 0;
        const view = heartsViewFor(state, seat);
        const action = chooseHeartsAction(view, `choice:${seed}:${steps}`);
        expect(action).toEqual(chooseHeartsAction(frozen(view), `choice:${seed}:${steps}`));
        if (action.type === 'play_card') expect(view.legal.playableCards).toContain(action.card);
        if (action.type === 'pass_cards') {
          expect(new Set(action.cards).size).toBe(3);
          action.cards.forEach(c => expect(view.hand).toContain(c));
        }
        const previous = state;
        state = applyHeartsAction(state, action);
        expect(state.rev).toBe(previous.rev + 1);
        const all = [...state.players.flatMap(p => [...p.hand, ...p.taken, ...p.passBuffer]), ...(state.currentTrick?.plays.map(p => p.card) ?? [])];
        expect(all.sort()).toEqual(buildHeartsDeck().sort());
        if (state.history.length > previous.history.length) {
          const record = state.history.at(-1)!;
          // Moon changes deltas, so the conservation invariant applies to raw taken points.
          expect(Object.values(record.taken).reduce((a, b) => a + b, 0)).toBe(state.rules.jackOfDiamonds ? 16 : 26);
          if (record.moon === null) expect(record.delta).toEqual(record.taken);
        }
      }
      expect(state.winner).not.toBeNull();
      expect(state.score[state.winner!]).toBe(Math.min(...Object.values(state.score)));
    }
  }, 60000);
});

describe('computer tactics and public play tracking', () => {
  it('passes a short queen and dangerous high spades before low cards', () => {
    const state = newHeartsGame('pass-tactics');
    state.players[0].hand = ['QS', 'AS', 'KS', '2C', '3C', '4C', '5C', '6C', '7C', '8C', '2D', '3D', '4D'];
    const action = chooseHeartsAction(heartsViewFor(state, 0), 'tactics');
    expect(action.type).toBe('pass_cards');
    if (action.type === 'pass_cards') expect(new Set(action.cards)).toEqual(new Set(['QS', 'AS', 'KS']));
  });
  it('protects a long queen suit when passing', () => {
    const state = newHeartsGame('long-queen');
    state.players[0].hand = ['QS', 'AS', 'KS', '2S', '3S', '4S', 'AH', 'KH', 'QH', '2C', '3C', '4C', '5C'];
    const action = chooseHeartsAction(heartsViewFor(state, 0), 'tactics');
    if (action.type !== 'pass_cards') throw new Error('Expected pass');
    expect(new Set(action.cards)).toEqual(new Set(['AH', 'KH', 'QH']));
  });
  it('ducks a penalty with the highest losing card and dumps the queen when void', () => {
    for (const [hand, plays, expected] of [
      [['2H', 'QH', 'AH'], ['KH'], 'QH'],
      [['QS', 'AH', 'AS'], ['2D'], 'QS'],
      [['2S', 'KS', '3D'], [], '2S'],
    ] as [HeartsCardId[], HeartsCardId[], HeartsCardId][]) {
      const state = position(hand, plays);
      state.heartsBroken = true;
      expect(chooseHeartsAction(heartsViewFor(state, 0), 'tactics')).toEqual({ type: 'play_card', seat: 0, card: expected });
    }
  });
  it('plays high on the first safe trick and refuses to act when inactive', () => {
    const state = position(['3C', 'AC', 'AH'], ['2C'], true);
    expect(chooseHeartsAction(heartsViewFor(state, 0), 'first')).toEqual({ type: 'play_card', seat: 0, card: 'AC' });
    expect(() => chooseHeartsAction(heartsViewFor(state, 1), 'inactive')).toThrow(IllegalAction);
  });
  it('tracks completed and current plays once, retaining the last trick across plays', () => {
    let state = newHeartsGame('tracking', { passing: 'none' });
    for (let i = 0; i < 5; i++) {
      state = applyHeartsAction(state, chooseHeartsAction(heartsViewFor(state, state.turn!), 'track'));
      const view = heartsViewFor(state, 0);
      expect(view.playedCards).toHaveLength(i + 1);
      expect(view.playedCards).toEqual([...state.tricks.flatMap(t => t.plays), ...state.currentTrick!.plays]);
      if (i >= 3) expect(view.lastTrick).toEqual(state.tricks[0]);
    }
  });
  it('scores a moon for seats other than South', () => {
    const state = finish(ending({ moon: 'subtract' }, {}, 3));
    expect(state.history[0]).toMatchObject({ moon: 3, delta: { 0: 0, 1: 0, 2: 0, 3: -26 } });
  });
});
