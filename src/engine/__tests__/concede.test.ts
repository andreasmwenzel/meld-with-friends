import { describe, expect, it } from 'vitest';
import { actionSchema } from '../../server/validation';
import { walk } from '../../components/replay/model';
import { chooseAction } from '../ai';
import { applyAction, legalActionsFor, newGame, normaliseHandRecord, viewFor } from '../game';
import { applyPublicMove, publicMove } from '../publicMove';
import { buildReplay, describeStep, expandReplay, handOutcome, rebuildFromLog } from '../replay';
import { buildScenario, checkState } from '../scenario';
import { presetById } from '../scenarios';
import type { Action, GameState, RulesConfig, SeatIndex } from '../types';

const seats = [0, 1, 2, 3] as const;
const names = (seat: SeatIndex) => ['South', 'West', 'North', 'East'][seat];
const concede: Action = { type: 'concede', seat: 0 };
function opening(rules: Partial<RulesConfig> = {}) {
  return buildScenario({ dealer: 3, bidder: 0, bid: rules.scoring === 'classic' ? 600 : 60,
    trump: 'S', rules: { scoring: 'modern', passCount: 0, ...rules }, to: 'playing' }).state;
}
function lead(state: GameState) {
  const seat = state.turn!;
  return applyAction(state, { type: 'play_card', seat, card: legalActionsFor(state, seat).playableCards[0] });
}

describe('throwing in', () => {
  it('is available only to the declarer on the opening lead of an ordinary contract', () => {
    const state = opening();
    for (const seat of seats) {
      expect(legalActionsFor(state, seat).canConcede).toBe(seat === 0);
      if (seat !== 0) expect(() => applyAction(state, { type: 'concede', seat })).toThrow();
    }
    expect(legalActionsFor(newGame('auction'), 1).canConcede).toBe(false);
    for (const phase of ['declaring_trump', 'melding', 'hand_over', 'game_over'] as const) {
      expect(() => applyAction({ ...state, phase }, concede)).toThrow();
    }
    expect(() => applyAction({ ...state, highBid: { ...state.highBid!, shoot: true } }, concede)).toThrow();
    expect(() => applyAction({ ...state, sittingOut: 2 }, concede)).toThrow();
    const played = lead(state);
    expect(seats.every(seat => !legalActionsFor(played, seat).canConcede)).toBe(true);
    expect(() => applyAction(played, concede)).toThrow();
    let later = played;
    for (let i = 0; i < 3; i++) later = lead(later);
    later.turn = 0;
    later.currentTrick = { leader: 0, plays: [], winner: null };
    expect(() => applyAction(later, concede)).toThrow();
  });

  it.each([
    { scoring: 'modern', mustTakeTrickToSaveMeld: true },
    { scoring: 'modern', mustTakeTrickToSaveMeld: false },
    { scoring: 'classic', counting: 'classic', mustTakeTrickToSaveMeld: true },
  ] satisfies Partial<RulesConfig>[])('scores the bid penalty and defenders meld only under %j', rules => {
    const state = opening(rules);
    // Explicit declared totals isolate scoring from which meld happens to be dealt.
    state.players.forEach((p, i) => { p.meldPoints = (i + 1) * 4; });
    const before = structuredClone(state);
    const next = applyAction(state, concede);
    const bid = state.highBid!.amount!;
    const record = next.history.at(-1)!;
    expect(state).toEqual(before);
    expect(record).toMatchObject({ conceded: true, wentSet: true, tricks: { red: 0, blue: 0 },
      delta: { red: -bid, blue: 24 }, meld: { red: 16, blue: 24 } });
    expect(record.breakdown.red).toEqual({ meldDeclared: 0, meldSaved: 0, counters: 0, lastTrick: 0, setPenalty: bid, shoot: 0 });
    expect(record.breakdown.blue).toEqual({ meldDeclared: 24, meldSaved: 24, counters: 0, lastTrick: 0, setPenalty: 0, shoot: 0 });
    expect(next.phase).toBe('hand_over');
    expect(next.turn).toBeNull();
    expect(next.currentTrick).toBeNull();
    expect(next.players.map(p => p.hand)).toEqual(state.players.map(p => p.hand));
    expect(next.log.at(-1)).toBe(`South throws in; Red goes set for ${bid}`);
    expect(normaliseHandRecord(record)).toEqual(record);
    const old: Omit<typeof record, 'breakdown'> & { breakdown?: typeof record.breakdown } = { ...record };
    delete old.breakdown;
    expect(normaliseHandRecord(old)).toEqual(record);
    expect(() => applyAction(next, concede)).toThrow();
    expect(applyAction(next, { type: 'next_hand', seat: 2 }).phase).toBe('bidding');
  });

  it('uses the same target check after applying the set and saved meld', () => {
    const state = opening();
    state.players[1].meldPoints = 10;
    state.players[3].meldPoints = 0;
    state.score = { red: 160, blue: 145 };
    const next = applyAction(state, concede);
    expect(next.score).toEqual({ red: 100, blue: 155 });
    expect(next.phase).toBe('game_over');
    expect(next.winner).toBe('blue');
    state.score = { red: 160, blue: 0 };
    expect(applyAction(state, concede).phase).toBe('hand_over');
    state.score.red = 220;
    expect(applyAction(state, concede).winner).toBe('red');
  });

  it('handles a Blue declarer and Red defenders', () => {
    const state = buildScenario({ dealer: 0, bidder: 1, bid: 60, trump: 'H', rules: { scoring: 'modern', passCount: 0 }, to: 'playing' }).state;
    const next = applyAction(state, { type: 'concede', seat: 1 });
    expect(next.history.at(-1)!.delta).toEqual({ red: state.players[0].meldPoints + state.players[2].meldPoints, blue: -60 });
  });

  it('reveals the snapshotted hands only when configured and keeps recap empty', () => {
    for (const revealHands of [true, false]) {
      const state = opening({ revealHands });
      const next = applyAction(state, concede);
      for (const seat of seats) {
        expect(viewFor(state, seat).revealed).toBeNull();
        const view = viewFor(next, seat);
        expect(view.hand).toEqual(state.players[seat].hand);
        expect(view.handCounts).toEqual([12, 12, 12, 12]);
        expect(view.recap).toMatchObject({ tricks: [], current: null, counters: { red: 0, blue: 0 }, trickCounts: { red: 0, blue: 0 } });
        expect(view.revealed?.atPlay ?? null).toEqual(revealHands ? Object.fromEntries(state.players.map(p => [p.seat, p.hand])) : null);
        expect(view.claim).toBeNull();
        expect(view.legal.canConcede).toBe(false);
      }
      expect(publicMove(state, next, concede)).toBeNull();
      expect(checkState(next)).toEqual([]);
    }
  });

  it('reconstructs concede legality from public moves on opening and later leads', () => {
    let state = opening();
    for (let i = 0; i < 5; i++) {
      const action: Action = { type: 'play_card', seat: state.turn!, card: legalActionsFor(state, state.turn!).playableCards[0] };
      const next = applyAction(state, action);
      const move = publicMove(state, next, action)!;
      expect(move).not.toBeNull();
      for (const seat of seats) expect(applyPublicMove(viewFor(state, seat), move)?.legal).toEqual(viewFor(next, seat).legal);
      state = next;
    }
  });

  it('round-trips a throw-in through log rebuild, packed replay, and the browser model', () => {
    let state = newGame('concede-replay', { passCount: 0, ninesMisdeal: false }, 3);
    const states = [state];
    const actions: Action[] = [];
    while (state.phase !== 'playing') {
      const seat = state.phase === 'melding' ? state.players.find(p => !p.meldConfirmed)!.seat : state.turn!;
      const action: Action = state.phase === 'bidding'
        ? state.highBid ? { type: 'pass_bid', seat } : { type: 'bid', seat, amount: 100 }
        : chooseAction(viewFor(state, seat), { budgetMs: 0 });
      state = applyAction(state, action); states.push(state); actions.push(action);
    }
    const action: Action = { type: 'concede', seat: state.bidder! };
    const before = state;
    state = applyAction(state, action); states.push(state); actions.push(action);
    const rebuilt = rebuildFromLog(state, actions)!;
    expect(rebuilt.states.at(-1)).toMatchObject(state);
    const replay = buildReplay(states, actions)!;
    const expanded = expandReplay(replay).at(-1)!;
    expect(expanded.history).toEqual(state.history);
    expect(expanded.players).toEqual(state.players);
    expect(describeStep(action, before, state, names)).toContain('throws in');
    expect(handOutcome(state.history[0], names)).toContain('threw in');
    expect(walk(replay, names).moves.at(-1)?.record?.conceded).toBe(true);
  });

  it('validates the server action strictly', () => {
    expect(actionSchema.parse(concede)).toEqual(concede);
    for (const value of [{ type: 'concede' }, { type: 'concede', seat: 4 }, { ...concede, amount: 60 }]) {
      expect(actionSchema.safeParse(value).success).toBe(false);
    }
  });

  it('provides valid opening and conceded presets', () => {
    const opening = buildScenario(presetById('play-concede')!.spec);
    expect(opening.notes).toEqual([]);
    expect(viewFor(opening.state, 0).legal.canConcede).toBe(true);
    expect(chooseAction(viewFor(opening.state, 0))).toEqual(concede);
    const ended = buildScenario(presetById('hand-conceded')!.spec);
    expect(ended.notes).toEqual([]);
    expect(ended.state.history.at(-1)?.conceded).toBe(true);
    expect(checkState(ended.state)).toEqual([]);
  });

  it.each([
    { scoring: 'modern', counterValue: 1, lastTrickBonus: 1 },
    { scoring: 'classic', counting: 'tens', counterValue: 10, lastTrickBonus: 10 },
    { scoring: 'classic', counting: 'classic', lastTrickBonus: 0 },
  ] satisfies Partial<RulesConfig>[])('bots throw in only below the maximum possible score under %j', rules => {
    const state = opening(rules);
    state.players.forEach(p => { p.meldPoints = 0; });
    state.players[2].meldPoints = 8;
    state.players[1].meldPoints = 1000; // Opponents' meld cannot help make the contract.
    const max = 8 + (state.rules.counting === 'classic' ? 240 : 24 * state.rules.counterValue) + state.rules.lastTrickBonus;
    state.highBid!.amount = max + 1;
    expect(chooseAction(viewFor(state, 0))).toEqual(concede);
    state.highBid!.amount = max;
    expect(chooseAction(viewFor(state, 0), { budgetMs: 0 }).type).not.toBe('concede');
    state.highBid!.amount = max - 1;
    expect(chooseAction(viewFor(state, 0), { budgetMs: 0 }).type).not.toBe('concede');
  });
});
