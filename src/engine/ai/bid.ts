import { DEFAULT_SETTINGS, type BotConfig } from '../../lib/settings';
import { computeMeld } from '../meld';
import type { PlayerView, Suit } from '../types';
import { points, suits, suitOf } from './shared';
export function projectedValue(view: PlayerView, trump: Suit, config: BotConfig = DEFAULT_SETTINGS.bots) {
  const length = view.hand.filter(c => suitOf(c) === trump).length;
  const aces = view.hand.filter(c => c[0] === 'A').length;
  const protectedTens = view.hand.filter(c => c[0] === 'T' && view.hand.some(a => a[0] === 'A' && a[1] === c[1])).length;
  const partnerBids = view.bids.filter(b => b.seat === (view.seat + 2) % 4);
  const signal = partnerBids.some(b => b.amount !== null) ? 100 + config.partnerBidBonus : partnerBids.some(b => b.amount === null) ? 25 : 60;
  // Retain half the signal for partner meld/tricks; the other half estimates
  // the benefit of passing. Four cards preserve the original projection.
  // More cards do not reliably add value, so cap the passing allowance there.
  const passingFactor = .5 + .5 * Math.min(view.rules.passCount, 4) / 4;
  const scale = (view.rules.counting === 'classic' ? 240 : 24 * view.rules.counterValue) / 240;
  return computeMeld(view.hand, trump).total + signal * passingFactor + config.bidAggression * (scale * (35 + length * 12 + aces * 17 + protectedTens * 8) + view.hand.reduce((n,c) => n + points(c, view.rules),0) * .15);
}
export const safetyMargin = DEFAULT_SETTINGS.bots.bidMargin;
export function bestTrump(view: PlayerView, config: BotConfig = DEFAULT_SETTINGS.bots): Suit {
  return [...suits].sort((a,b) => projectedValue(view,b,config)-projectedValue(view,a,config))[0];
}
export function overwhelming(view: PlayerView, config: BotConfig = DEFAULT_SETTINGS.bots) {
  return suits.some(s => view.hand.filter(c => suitOf(c) === s).length >= config.shootMinTrump && view.hand.filter(c => suitOf(c) === s && c[0] === 'A').length === 2 && suits.every(side => side === s || view.hand.some(c => suitOf(c) === side && c[0] === 'A')));
}
