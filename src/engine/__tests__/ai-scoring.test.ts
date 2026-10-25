import { expect, it } from 'vitest';
import { compareScoring } from '../ai/arena';
import { chooseAction } from '../ai';
import { bestTrump, projectedValue } from '../ai/bid';
import { newGame, viewFor } from '../game';

it.each([0, 3])('keeps seeded bot decisions and contracts equivalent across scales, budget %i', budget => {
  const result = compareScoring(12, budget, 'scale-regression');
  expect(result.mismatchedHands).toBe(0);
  expect(result.modern.sets).toBe(result.classic.sets);
  expect(result.modern.contracts).toBe(result.classic.contracts);
  expect(result.modern.meanBid * 10).toBeCloseTo(result.classic.meanBid);
});

it.each(['modern', 'classic'] as const)('bids legal steps above the minimum with %s scoring', scoring => {
  let bids = 0;
  for (let i = 0; i < 24; i++) {
    const factor = scoring === 'modern' ? 1 : 10;
    const view = viewFor(newGame(`bid-steps:${i}`, { scoring, minBid: 25 * factor, bidStep: 2 * factor }), 1);
    const action = chooseAction(view, { budgetMs: 0 });
    if (action.type === 'bid') {
      bids++;
      expect(action.amount).toBeGreaterThanOrEqual(view.rules.minBid);
      expect(action.amount % view.rules.bidStep).toBe(0);
      expect(action.amount).toBeLessThanOrEqual(projectedValue(view, bestTrump(view)) - 2 * factor);
    }
  }
  expect(bids).toBeGreaterThan(0);
});
