import { describe, expect, it } from 'vitest';
import { canClaim, claimLine } from '../claim';
import { buildDeck, seededShuffle } from '../deck';
import { applyAction, newGame, viewFor } from '../game';
import { chooseAction } from '../ai';
import { leakedCards, verifyClaim } from '../fuzz';
import { buildScenario, checkState } from '../scenario';
import { PRESETS } from '../scenarios';
import { buildReplay, cardsOfStep, describeStep, expandReplay } from '../replay';
import { applyPublicMove, publicMove } from '../publicMove';
import type { Action, CardId, GameState, PlayerView, RulesConfig } from '../types';

const spec = PRESETS.find(p => p.id === 'claim-all')!.spec;
const seats = [0, 1, 2, 3] as const;
const position = (hand: CardId[], unseen: CardId[]): PlayerView => ({
  ...viewFor(newGame('proof'), 0), phase: 'playing', seat: 0, turn: 0, trump: 'S', hand,
  playedCards: buildDeck().filter(card => !hand.includes(card) && !unseen.includes(card)).map(card => ({ seat: 1, card })),
  currentTrick: { leader: 0, plays: [], winner: null },
});

/** Ordinary actions only, with the same line and deterministic first legal replies as a claim. */
function playOut(start: GameState): GameState {
  const seat = start.turn!;
  const line = claimLine(viewFor(start, seat))!;
  let state = start;
  for (const lead of line) {
    for (let n = 0; n < 4; n++) {
      const who = state.turn!;
      state = applyAction(state, { type: 'play_card', seat: who, card: n ? viewFor(state, who).legal.playableCards[0] : lead });
    }
  }
  return state;
}

describe('claim proof from the leader’s own view', () => {
  it('allows the owner’s hand 3 example after three tricks', () => {
    const { state, notes } = buildScenario(spec);
    const view = viewFor(state, 0);
    expect(notes).toEqual([]);
    expect(view.hand.filter(c => c[1] === 'S')).toHaveLength(6);
    expect(view.hand.filter(c => c[1] !== 'S').sort()).toEqual(['AC0', 'AC1', 'AD0']);
    expect(view.playedCards.filter(p => p.card[1] === 'S')).toHaveLength(6);
    expect(canClaim(view)).toBe(true);
    expect(claimLine(view)!.slice(0, 6).every(c => c[1] === 'S')).toBe(true);
    expect(verifyClaim(state, 'owner-example')).toBe(32);
  });

  it('an equal-rank duplicate loses to the lead, including the last trick', () => {
    expect(canClaim(position(['AS0'], ['AS1', 'AH0', 'AD0']))).toBe(true);
    expect(canClaim(position(['AC0'], ['AC1', 'TC0', 'KC0']))).toBe(true);
    expect(canClaim(position(['TS0'], ['AS0', 'AH0', 'AD0']))).toBe(false);
  });

  it('refuses a side winner while an unseen trump could survive the trump leads', () => {
    expect(canClaim(position(['AC0'], ['9S0', 'AC1', 'TC0']))).toBe(false);
    expect(canClaim(position(['AS0', 'AS1', 'AC0'], ['TS0', 'TS1', 'KS0', 'AH0', 'AH1', 'TH0', 'TH1', 'KH0', 'KH1']))).toBe(false);
  });

  it('draws lower unseen trumps before leading side winners', () => {
    expect(claimLine(position(['AC0', 'AS1', 'AS0'], ['TS0', 'TS1', 'AH0', 'AH1', 'TH0', 'TH1', 'KH0', 'KH1', 'QH0'])))
      .toEqual(['AS0', 'AS1', 'AC0']);
  });

  it('keeps an unseen high duplicate until it must have followed', () => {
    expect(canClaim(position(['AS0', 'TS0'], ['AS1', 'QS0', 'AH0', 'TH0', 'KH0', 'QH0']))).toBe(false);
    expect(canClaim(position(['AS0', 'TS0'], ['AS1', 'AH0', 'TH0', 'KH0', 'QH0', 'JH0']))).toBe(true);
  });

  it('only offers the claim on lead before anyone has played', () => {
    const { state } = buildScenario(spec);
    for (const seat of seats) expect(viewFor(state, seat).legal.canClaim).toBe(seat === 0);
    const led = applyAction(state, { type: 'play_card', seat: 0, card: claimLine(viewFor(state, 0))![0] });
    for (const seat of seats) {
      expect(viewFor(led, seat).legal.canClaim).toBe(false);
      expect(() => applyAction(led, { type: 'claim', seat })).toThrow(/cannot claim/);
    }
    expect(() => applyAction(state, { type: 'claim', seat: 1 })).toThrow(/cannot claim/);
    expect(canClaim(viewFor(newGame('bidding'), 1))).toBe(false);
    expect(canClaim({ ...viewFor(state, 0), hand: [] })).toBe(false);
  });

  it('cannot use partner ownership, public meld, or the hidden deal to justify a claim', () => {
    const { state } = buildScenario({ ...spec, tricks: 0 });
    const hand = [...state.players[0].hand];
    const played = viewFor(state, 0).playedCards;
    for (let n = 0; n < 20; n++) {
      const swapped = structuredClone(state);
      const rest = seededShuffle(state.players.slice(1).flatMap(p => p.hand), `swap:${n}`);
      for (const seat of [1, 2, 3] as const) swapped.players[seat].hand = rest.slice((seat - 1) * 12, seat * 12);
      const view = viewFor(swapped, 0);
      expect(view.hand).toEqual(hand);
      expect(view.playedCards).toEqual(played);
      expect(view.legal.canClaim).toBe(viewFor(state, 0).legal.canClaim);
      expect(view.claim).toBeNull();
      expect(view.revealed).toBeNull();
      expect(leakedCards(swapped, 0)).toEqual([]);
    }
    const uncertain = position(['TC0'], ['AC0', 'AC1', '9H0']);
    uncertain.melds[2] = [{ kind: 'aces_around', cards: ['AC0', 'AC1'], points: 10 }];
    expect(canClaim(uncertain)).toBe(false);
  });
});

describe('claim settlement', () => {
  const configs: Partial<RulesConfig>[] = [
    { scoring: 'modern' }, { scoring: 'classic', counting: 'tens' }, { scoring: 'classic', counting: 'classic' },
    { scoring: 'modern', counterValue: 3, lastTrickBonus: 2, mustTakeTrickToSaveMeld: false },
    { scoring: 'modern', counterValue: 0, lastTrickBonus: 0, revealHands: false },
  ];
  it.each(configs)('matches ordinary play, counters, last trick and recap with %j', rules => {
    const { state } = buildScenario({ ...spec, rules: { ...spec.rules, ...rules } });
    const before = structuredClone(state);
    const played = playOut(state);
    const claimed = applyAction(state, { type: 'claim', seat: 0 });
    expect(state).toEqual(before);
    expect(claimed.rev).toBe(state.rev + 1);
    expect(claimed.history).toEqual(played.history);
    expect(claimed.score).toEqual(played.score);
    expect(claimed.tricksTaken).toEqual(played.tricksTaken);
    expect(viewFor(claimed, 0).recap).toEqual(viewFor(played, 0).recap);
    expect(claimed.log).toContain('South claims the rest.');
    expect(claimed.log.filter(line => line.includes(' plays '))).toEqual(state.log.filter(line => line.includes(' plays ')));
    expect(checkState(claimed)).toEqual([]);
    for (const seat of seats) {
      const view = viewFor(claimed, seat);
      expect(view.claim).toEqual({ seat: 0, fromTrick: 4, hands: Object.fromEntries(state.players.map(p => [p.seat, p.hand])) });
      expect(view.legal.canClaim).toBe(false);
      expect(leakedCards(claimed, seat)).toEqual([]);
    }
    if (!rules.revealHands && rules.revealHands !== undefined) expect(viewFor(claimed, 1).revealed).toBeNull();
    if (claimed.phase === 'hand_over') expect(viewFor(applyAction(claimed, { type: 'next_hand', seat: 0 }), 0).claim).toBeNull();
  });

  it.each(['points', 'game'] as const)('settles a legacy four-player shoot in %s mode', mode => {
    const { state } = buildScenario(spec);
    state.highBid = { ...state.highBid!, shoot: true };
    state.legacyShootRules = { mode, points: 100 };
    const claimed = applyAction(state, { type: 'claim', seat: 0 });
    expect(claimed.history).toEqual(playOut(state).history);
    expect(claimed.history.at(-1)?.shotMade).toBe(true);
  });

  it('lets a shooter claim, and nobody else learns the cards it passed back', () => {
    const { state } = buildScenario({ ...spec, rules: { ...spec.rules, shoot: 'on' }, shoot: true });
    expect(state.sittingOut).toBe(2);
    expect(viewFor(state, 0).legal.canClaim).toBe(true);
    expect(verifyClaim(state, 'solo-shoot')).toBe(32);
    for (const seat of [1, 3] as const) expect(viewFor(state, seat).legal.canClaim).toBe(false);
    const claimed = applyAction(state, { type: 'claim', seat: 0 });
    expect(claimed.history.at(-1)?.shotMade).toBe(true);
    for (const seat of seats) expect(leakedCards(claimed, seat)).toEqual([]);
  });

  it('a shooter remembers the cards it passed back to its sitting-out partner', () => {
    // The only unseen card that beats the lead was passed back, so it never reaches the table.
    const view = position(['TS0'], ['AS0', 'KH0', 'KD0']);
    expect(canClaim(view)).toBe(false);
    expect(canClaim({ ...view, outOfPlay: ['AS0'] })).toBe(true);
    expect(canClaim({ ...view, outOfPlay: ['KH0'] })).toBe(false);
  });

  it('bots claim and replay preserves the claim and revealed hands', () => {
    const { state, base, actions } = buildScenario(spec);
    const action: Action = { type: 'claim', seat: 0 };
    expect(chooseAction(viewFor(state, 0))).toEqual(action);
    const claimed = applyAction(state, action);
    const states = [base];
    for (const a of [...actions, action]) states.push(applyAction(states.at(-1)!, a));
    const replay = buildReplay(states, [...actions, action])!;
    const end = expandReplay(replay).at(-1)!;
    expect(end.score).toEqual(claimed.score);
    expect(viewFor(end, 0).claim).toEqual(viewFor(claimed, 0).claim);
    expect(describeStep(action, state, claimed, seat => `Seat ${seat}`)).toMatch(/^Seat 0 claims the rest\./);
    expect(cardsOfStep(action, claimed)).toHaveLength(36);
    expect(publicMove(state, claimed, action)).toBeNull();
  });

  it('recomputes the same claim permission after a signed public trick completion', () => {
    const { base, actions } = buildScenario(spec);
    let before = base;
    for (const action of actions.slice(0, -1)) before = applyAction(before, action);
    const action = actions.at(-1)!;
    const next = applyAction(before, action);
    const move = publicMove(before, next, action)!;
    expect(move).not.toBeNull();
    for (const seat of seats) expect(applyPublicMove(viewFor(before, seat), move)).toEqual(viewFor(next, seat));
    expect(viewFor(next, 0).legal.canClaim).toBe(true);
  });
});
