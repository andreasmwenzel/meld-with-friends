import { expect, it } from 'vitest';
import { applyAction, legalActionsFor, newGame, SEAT_NAMES, viewFor } from '../game';
import { cardLabel } from '../deck';
import { trickWinner } from '../rules';
import type { Action, CardId, GameState, HandRecap, RulesConfig, SeatIndex } from '../types';

const seats = [0, 1, 2, 3] as const;
const classic = { A: 11, T: 10, K: 4, Q: 3, J: 2, '9': 0 };
function advance(state: GameState): Action {
  const seat = state.turn ?? seats.find(s => !state.players[s].meldConfirmed)!;
  const legal = legalActionsFor(state, seat);
  if (legal.canPassBid) return { type: 'pass_bid', seat };
  if (legal.canDeclareTrump) return { type: 'declare_trump', seat, suit: 'S' };
  if (legal.mustPassCount !== null) return { type: 'pass_cards', seat, cards: state.players[seat].hand.slice(0, legal.mustPassCount) };
  if (legal.canConfirmMeld) return { type: 'confirm_meld', seat };
  return { type: 'play_card', seat, card: legal.playableCards[0] };
}
function cardsIn(value: unknown): CardId[] {
  if (typeof value === 'string' && /^[ATKQJ9][SHDC][01]$/.test(value)) return [value as CardId];
  if (value && typeof value === 'object') return Object.values(value).flatMap(cardsIn);
  return [];
}

// Two different deals per rules combination retain every-play coverage without
// replaying 50 hands and exhausting the default timeout during concurrent suites.
it.each([
  { counting: 'tens', passCount: 0, seeds: [0, 6] },
  { counting: 'classic', passCount: 0, seeds: [3, 9] },
  { counting: 'tens', passCount: 4, seeds: [2, 4] },
  { counting: 'classic', passCount: 4, seeds: [1, 5] },
] satisfies (Pick<RulesConfig, 'counting' | 'passCount'> & { seeds: number[] })[])(
  'recaps seeded hands against every play and trick log: $counting counting, $passCount passed cards',
  ({ counting, passCount, seeds }) => {
    for (const seed of seeds) {
      const rules = { counting, passCount };
      let state = newGame(`recap:${seed}`, rules);
      const expected: HandRecap['tricks'] = [];
      const passedOut: Record<SeatIndex, CardId[]> = { 0: [], 1: [], 2: [], 3: [] };
      const passedIn: Record<SeatIndex, CardId[]> = { 0: [], 1: [], 2: [], 3: [] };
      while (state.phase !== 'hand_over' && state.phase !== 'game_over') {
        const action = advance(state);
        const previous = state;
        state = applyAction(state, action);
        if (action.type === 'pass_cards') {
          const recipient = previous.phase === 'passing_to_bidder' ? previous.bidder! : ((previous.bidder! + 2) % 4) as SeatIndex;
          passedOut[action.seat].push(...action.cards);
          passedIn[recipient].push(...action.cards);
        }
        if (action.type === 'play_card') {
          expect(state.log).toContain(`${SEAT_NAMES[action.seat]} plays ${cardLabel(action.card)}`);
          if (previous.currentTrick!.plays.length === 3) {
            const plays = [...previous.currentTrick!.plays, { seat: action.seat, card: action.card }];
            const winner = trickWinner({ leader: previous.currentTrick!.leader, plays, winner: null }, state.trump!);
            expect(state.log).toContain(`${SEAT_NAMES[winner]} takes the trick`);
            const counters = plays.reduce((n, p) => n + (rules.counting === 'classic' ? classic[p.card[0] as keyof typeof classic] : 'ATK'.includes(p.card[0]) ? state.rules.counterValue : 0), 0);
            expected.push({ index: expected.length + 1, leader: previous.currentTrick!.leader, plays, winner, counters });
          }
        }
        const publicCards = new Set([...expected.flatMap(t => t.plays.map(p => p.card)), ...(state.currentTrick?.plays.map(p => p.card) ?? []), ...state.players.flatMap(p => p.meld.flatMap(m => m.cards))]);
        const totals = { red: { tricks: 0, counters: 0 }, blue: { tricks: 0, counters: 0 } };
        for (const trick of expected) {
          const team = trick.winner % 2 === 0 ? 'red' : 'blue';
          totals[team].tricks++;
          totals[team].counters += trick.counters;
        }
        for (const seat of seats) {
          const recap = viewFor(state, seat).recap;
          expect(recap.tricks).toEqual(expected);
          expect(recap.bids).toEqual(state.bids);
          expect(recap.current).toEqual(state.currentTrick);
          expect(recap.myPassedOut).toEqual(passedOut[seat]);
          expect(recap.myPassedIn).toEqual(passedIn[seat]);
          const permitted = new Set([...publicCards, ...passedOut[seat], ...passedIn[seat]]);
          const recapCards = new Set(cardsIn(recap));
          expect([...recapCards].every(card => permitted.has(card))).toBe(true);
          // West never receives another partnership's hidden passes or unplayed hand.
          if (seat === 1) for (const card of state.players[0].hand) {
            if (!publicCards.has(card)) expect(recapCards.has(card)).toBe(false);
          }
          for (const team of ['red', 'blue'] as const) {
            expect(recap.trickCounts[team]).toBe(totals[team].tricks);
            expect(recap.counters[team]).toBe(totals[team].counters);
          }
        }
      }
      expect(expected).toHaveLength(12);
      const recap = viewFor(state, 1).recap;
      const record = state.history[0];
      expect(recap.counters.red + recap.counters.blue).toBe(record.tricks.red + record.tricks.blue - state.rules.lastTrickBonus);
      if (state.phase === 'hand_over') {
        const next = viewFor(applyAction(state, { type: 'next_hand', seat: 1 }), 1).recap;
        expect(next.tricks).toEqual([]);
        expect(next.myPassedIn).toEqual([]);
        expect(next.myPassedOut).toEqual([]);
        expect(next.passing.done).toBe(false);
      }
    }
  },
);

it('loads older stored states without recap fields or pace', () => {
  const state = JSON.parse(JSON.stringify(newGame('legacy')));
  for (const key of ['completedTricks', 'passedOut', 'passedIn']) delete state[key];
  delete state.rules.pace;
  const view = viewFor(state, 1);
  expect(view.rules.pace).toBe('live');
  expect(view.recap.tricks).toEqual([]);
  expect(view.recap.myPassedOut).toEqual([]);
  expect(view.recap.myPassedIn).toEqual([]);
  expect(() => applyAction(state, { type: 'pass_bid', seat: 1 })).not.toThrow();
});

it('validates pace and defaults to live', () => {
  expect(newGame('pace').rules.pace).toBe('live');
  expect(newGame('pace', { pace: 'leisurely' }).rules.pace).toBe('leisurely');
  expect(() => newGame('pace', { pace: 'fast' as RulesConfig['pace'] })).toThrow('Invalid pace');
});
