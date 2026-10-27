import { expect, it } from 'vitest';
import { arena } from '../ai/arena';
import { DEFAULT_SETTINGS } from '@/lib/settings';
import { projectedValue, overwhelming } from '../ai/bid';
import { newGame, viewFor } from '../game';
it('returns complete admin arena metrics for full games', () => {
  const result = arena(2, 1, 'settings-test', { ...DEFAULT_SETTINGS.bots, samples: 1 });
  expect(result.games).toBe(2);
  expect(result.botWins + result.randomWins).toBe(2);
  for (const key of ['avgDecisionMs', 'avgGameMs', 'avgBidMade'] as const) expect(Number.isFinite(result[key])).toBe(true);
  expect(result.avgBidMade).toBeGreaterThanOrEqual(0);
  expect(result.avgBidMade).toBeLessThanOrEqual(1);
});
it('maps aggression, partner bonus, and shoot threshold into bidding', () => {
  const view = viewFor(newGame('config', { scoring: 'classic' }), 1);
  const c = DEFAULT_SETTINGS.bots;
  expect(projectedValue(view, 'S', { ...c, bidAggression: 2 })).toBeGreaterThan(projectedValue(view, 'S', c));
  view.bids = [{ seat: 3, amount: 250 }];
  expect(projectedValue(view, 'S', { ...c, partnerBidBonus: c.partnerBidBonus + 20 })).toBe(projectedValue(view, 'S', c) + 20);
  view.phase = 'deciding_shoot';
  view.trump = 'S';
  view.hand = ['AS0','AS1','TS0','TS1','KS0','QS0','JS0','9S0','AH0','AD0','AC0','AC1'];
  expect(overwhelming(view, { ...c, shootMinTrump: 8 })).toBe(true);
  expect(overwhelming(view, { ...c, shootMinTrump: 9 })).toBe(false);
});
