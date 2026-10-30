import { expect, it } from 'vitest';
import { applyAction, newGame } from '@/engine/game';
import { buildReplay } from '@/engine/replay';
import type { Action } from '@/engine/types';
import { walk } from '../model';

const nameOf = (seat: number) => ['South', 'West', 'North', 'East'][seat];

it('walks a partial first hand without a score record', () => {
  const start = newGame('partial-hand', {}, 0);
  const action: Action = { type: 'bid', seat: 1, amount: start.rules.minBid };
  const final = applyAction(start, action);
  const replay = buildReplay([start, final], [action], { complete: true })!;
  const model = walk(replay, nameOf);
  expect(model.frames.at(-1)!.phase).toBe('bidding');
  expect(model.chapters).toEqual([{ hand: 1, first: 0, last: 1, record: null, title: '(unfinished)' }]);
  expect(model.moves.at(-1)!.label).toContain('West bids');
});

it('shows the new deal when abandonment immediately follows an all-pass redeal', () => {
  const start = newGame('redeal', { dealerStuck: false }, 0);
  const states = [start];
  const actions: Action[] = [1, 2, 3, 0].map(seat => ({ type: 'pass_bid', seat: seat as 0 | 1 | 2 | 3 }));
  for (const action of actions) states.push(applyAction(states.at(-1)!, action));
  const replay = buildReplay(states, actions, { complete: true })!;
  expect(replay.hands).toBe(2);
  const model = walk(replay, nameOf);
  expect(model.chapters).toHaveLength(2);
  expect(model.chapters[0].title).toContain('Everyone passed');
  expect(model.chapters[1]).toMatchObject({ hand: 2, record: null, title: '(unfinished)' });
  expect(model.moves.at(-1)).toMatchObject({ hand: 2, kind: 'deal', label: 'Hand 2: West deals' });
});
