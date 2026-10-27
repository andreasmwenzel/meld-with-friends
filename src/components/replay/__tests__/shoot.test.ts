import { expect, it } from 'vitest';
import { applyAction } from '@/engine/game';
import { buildReplay } from '@/engine/replay';
import { buildScenario } from '@/engine/scenario';
import { presetById } from '@/engine/scenarios';
import { walk } from '../model';

it.each(['hand-shoot-made', 'hand-shoot-missed'])('describes the solo declaration, three-card tricks and %s in replay', id => {
  const { base, actions } = buildScenario(presetById(id)!.spec);
  const states = [base];
  for (const action of actions) states.push(applyAction(states.at(-1)!, action));
  const replay = buildReplay(states, actions)!;
  const model = walk(replay, seat => ['South', 'West', 'North', 'East'][seat]);
  expect(model.moves.some(m => m.label.includes('North sits out; no meld'))).toBe(true);
  expect(model.moves.some(m => m.kind === 'meld')).toBe(false);
  const tricks = model.moves.flatMap(m => m.trick ? [m.trick] : []);
  expect(tricks.every(t => t.plays.length === 3 && !t.plays.some(p => p.seat === 2))).toBe(true);
  const last = model.moves.at(-1)!;
  if (id === 'hand-shoot-made') {
    // The shooter holds a proven line from the first lead, so it claims the rest.
    expect(last.kind).toBe('claim');
    expect(last.label).toContain('claims the rest');
    expect(last.label).toContain('shot the moon');
  } else {
    expect(tricks).toHaveLength(1);
    expect(last.label).toContain('shooting side loses the game');
  }
});
