import { expect, it } from 'vitest';
import { applyAction, newGame, viewFor } from '../game';
import { randomAction } from '../ai/arena';
import { random } from '../ai/shared';
import { buildReplay, cardsOfStep, describeStep, expandReplay, rebuildFromLog } from '../replay';
import type { Action, GameState, RulesConfig, SeatIndex } from '../types';

const NAMES = ['South', 'West', 'North', 'East'];
const nameOf = (seat: SeatIndex) => NAMES[seat];

/** Plays with the arena's random legal player until `done`, keeping the log. */
function play(seed: string, rules: Partial<RulesConfig>, dealer: SeatIndex, done: (state: GameState, actions: Action[]) => boolean) {
  const rng = random(`${seed}:rng`);
  let state = newGame(seed, rules, dealer);
  const states = [state];
  const actions: Action[] = [];
  while (!done(state, actions)) {
    if (actions.length > 20000) throw new Error('Game did not finish');
    const seat = (state.phase === 'melding' ? state.players.find(p => !p.meldConfirmed)!.seat : state.turn ?? 0) as SeatIndex;
    const action = randomAction(viewFor(state, seat), rng);
    state = applyAction(state, action);
    states.push(state); actions.push(action);
  }
  return { state, states, actions };
}
const SECRET = 'replay-secret-seed';

it('rebuilds a finished game from its log and packs every hand without the seed', () => {
  const { state, states, actions } = play(`${SECRET}:1`, {}, 2, s => s.phase === 'game_over');
  const rebuilt = rebuildFromLog(state, actions);
  expect(rebuilt).not.toBeNull();
  expect(rebuilt!.start.dealer).toBe(2);
  expect(rebuilt!.states.length).toBe(states.length);

  const replay = buildReplay(rebuilt!.states, actions)!;
  expect(replay.finished).toBe(true);
  expect(replay.hands).toBe(state.history.length);
  expect(replay.steps.length).toBe(actions.length);
  expect(JSON.stringify(replay)).not.toContain(SECRET);
  // Dealt positions travel with the step that dealt them, and only those.
  replay.steps.forEach((step, i) => {
    const dealt = states[i + 1].handNumber !== states[i].handNumber;
    expect(!!step.state).toBe(dealt);
    if (step.state) expect(step.state.seed).toBe('');
  });
  const frames = expandReplay(replay);
  expect(frames.length).toBe(states.length);
  const last = frames[frames.length - 1];
  expect(last.rev).toBe(state.rev);
  expect(last.score).toEqual(state.score);
  expect(last.players.map(p => p.hand)).toEqual(state.players.map(p => p.hand));
});

it('leaves the hand in progress out of an unfinished game', () => {
  const { state, actions } = play(`${SECRET}:2`, {}, 0, s => s.history.length === 2 && s.phase === 'bidding' && s.bids.length >= 2);
  expect(state.handNumber).toBe(3);
  const rebuilt = rebuildFromLog(state, actions)!;
  const replay = buildReplay(rebuilt.states, actions)!;
  expect(replay.finished).toBe(false);
  expect(replay.hands).toBe(2);
  expect(JSON.stringify(replay)).not.toContain(SECRET);
  const frames = expandReplay(replay);
  expect(Math.max(...frames.map(f => f.handNumber))).toBe(2);
  expect(frames[frames.length - 1].phase).toBe('hand_over');
  expect(replay.steps.length).toBeLessThan(actions.length);
  // The step that dealt hand three is not there either.
  expect(replay.steps.some(step => step.action.type === 'next_hand' && step.state?.handNumber === 3)).toBe(false);
});

it('has nothing to show before the first hand is over', () => {
  const { state, states, actions } = play(`${SECRET}:3`, {}, 1, s => s.phase === 'playing' && s.tricksTaken.red.length + s.tricksTaken.blue.length >= 3);
  expect(state.history.length).toBe(0);
  expect(buildReplay(states, actions)).toBeNull();
});

it('refuses a log that no longer reaches the stored state', () => {
  const { state, actions } = play(`${SECRET}:4`, {}, 3, s => s.history.length === 1);
  expect(rebuildFromLog(state, actions)).not.toBeNull();
  expect(rebuildFromLog(state, actions.slice(0, -1))).toBeNull();
  expect(rebuildFromLog({ ...state, seed: 'other' }, actions)).toBeNull();
});

it('describes tricks, hand outcomes and redeals', () => {
  const { states, actions } = play(`${SECRET}:5`, {}, 0, s => s.history.length === 1);
  const lines = actions.map((action, i) => describeStep(action, states[i], states[i + 1], nameOf));
  const fourth = actions.findIndex((a, i) => a.type === 'play_card' && states[i].currentTrick?.plays.length === 3);
  expect(lines[fourth]).toMatch(/plays .+\. (South|West|North|East) takes the trick$/);
  expect(lines[lines.length - 1]).toMatch(/takes the trick\. (South|West|North|East) (made|went set on) \d+ in [♠♥♦♣]\. Red (scores|loses) \d+, Blue (scores|loses) \d+$/);
  const startsPlay = actions.findIndex((a, i) => a.type === 'confirm_meld' && states[i + 1].phase === 'playing');
  expect(lines[startsPlay]).toMatch(/leads$/);
  const auctionEnd = actions.findIndex((_a, i) => states[i].bidder === null && states[i + 1].bidder !== null);
  expect(lines[auctionEnd]).toMatch(/takes it at \d+|is stuck with \d+/);
  expect(cardsOfStep(actions[fourth], states[fourth + 1])).toEqual([(actions[fourth] as { card: string }).card]);

  // With the dealer allowed to throw the hand in, four passes redeal; that deal rides with the step.
  for (let i = 0; i < 40; i++) {
    const { states, actions } = play(`${SECRET}:redeal:${i}`, { dealerStuck: false }, 0, (s, a) => s.handNumber > 1 || a.length > 4);
    const redeal = actions.findIndex((a, j) => a.type === 'pass_bid' && states[j + 1].handNumber === 2);
    if (redeal < 0) continue;
    expect(describeStep(actions[redeal], states[redeal], states[redeal + 1], nameOf)).toMatch(/redeals$/);
    const { state, actions: all } = play(`${SECRET}:redeal:${i}`, { dealerStuck: false }, 0, s => s.history.length === 1);
    const replay = buildReplay(rebuildFromLog(state, all)!.states, all)!;
    expect(replay.steps[redeal].state?.handNumber).toBe(2);
    expect(expandReplay(replay).length).toBe(all.length + 1);
    return;
  }
  throw new Error('No seed produced a redeal');
});
