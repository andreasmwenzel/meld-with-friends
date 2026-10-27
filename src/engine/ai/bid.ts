import { DEFAULT_SETTINGS, type BotConfig } from '../../lib/settings';
import { computeMeld } from '../meld';
import { scoringFactor } from '../scoring';
import type { PlayerView, SeatIndex, Suit } from '../types';
import { points, suits, suitOf } from './shared';

/**
 * Partner signals in classic units; docs/COMPUTER_PLAYERS.md lists the conventions. Bots never
 * jump, but a partner's jump over the cheapest legal bid reads as meld, up to two steps.
 */
export const SIGNAL = { unknown: 60, passed: 25, bid: 100, perJumpStep: 30, maxJumpSteps: 2 } as const;

const partnerOf = (seat: SeatIndex) => ((seat + 2) % 4) as SeatIndex;

/** Replays the public auction: each call with the steps it jumped over the cheapest legal bid. */
export function auction(view: PlayerView) {
  let high = 0, holder: SeatIndex | null = null;
  return view.bids.map(call => {
    const over = holder;
    const cheapest = Math.ceil(Math.max(view.rules.minBid, high + 1) / view.rules.bidStep) * view.rules.bidStep;
    const jump = call.amount === null || call.shoot ? 0 : Math.max(0, Math.round((call.amount - cheapest) / view.rules.bidStep));
    if (call.amount !== null) { high = call.amount; holder = call.seat; }
    return { ...call, jump, over };
  });
}

/** What partner's calls say about partner's hand, in classic units. */
export function partnerSignal(view: PlayerView, config: BotConfig = DEFAULT_SETTINGS.bots) {
  const calls = auction(view).filter(c => c.seat === partnerOf(view.seat));
  const bids = calls.filter(c => c.amount !== null);
  if (bids.length) return SIGNAL.bid + config.partnerBidBonus + SIGNAL.perJumpStep * Math.min(SIGNAL.maxJumpSteps, Math.max(...bids.map(b => b.jump)));
  // Passing over our own side's high bid only says partner had no reason to take it over.
  return calls.some(c => c.over !== view.seat) ? SIGNAL.passed : SIGNAL.unknown;
}

export function projectedValue(view: PlayerView, trump: Suit, config: BotConfig = DEFAULT_SETTINGS.bots, signal = partnerSignal(view, config)) {
  const length = view.hand.filter(c => suitOf(c) === trump).length;
  const aces = view.hand.filter(c => c[0] === 'A').length;
  const protectedTens = view.hand.filter(c => c[0] === 'T' && view.hand.some(a => a[0] === 'A' && a[1] === c[1])).length;
  const factor = scoringFactor(view.rules);
  // Retain half the signal for partner meld/tricks; the other half estimates
  // the benefit of passing. Four cards preserve the original projection.
  // More cards do not reliably add value, so cap the passing allowance there.
  const passingFactor = .5 + .5 * Math.min(view.rules.passCount, 4) / 4;
  const scale = (view.rules.counting === 'classic' ? 240 : 24 * view.rules.counterValue / factor) / 240;
  // Evaluate in classic units before scaling to keep tie-breaking identical.
  return factor * (computeMeld(view.hand, trump, view.rules).total / factor + signal * passingFactor + config.bidAggression * (scale * (35 + length * 12 + aces * 17 + protectedTens * 8) + view.hand.reduce((n,c) => n + points(c, view.rules) / factor,0) * .15));
}
export const safetyMargin = DEFAULT_SETTINGS.bots.bidMargin;
export function bestTrump(view: PlayerView, config: BotConfig = DEFAULT_SETTINGS.bots): Suit {
  return [...suits].sort((a,b) => projectedValue(view,b,config)-projectedValue(view,a,config))[0];
}
/** The highest legal bid the projection supports, with an optional partner signal override. */
export function bidCeiling(view: PlayerView, config: BotConfig = DEFAULT_SETTINGS.bots, signal = partnerSignal(view, config)) {
  const value = Math.max(...suits.map(s => projectedValue(view, s, config, signal))) - config.bidMargin * scoringFactor(view.rules);
  // Legal bid amounts are multiples of bidStep, including the opening bid.
  return Math.floor(value / view.rules.bidStep + 1e-9) * view.rules.bidStep;
}

/**
 * The bid to make, or null to pass. Bots bid the cheapest legal amount the projection supports,
 * but never bid over their own partner just to keep bidding: they take over partner's high bid
 * only when their hand could carry the contract with no help from partner.
 */
export function chooseBid(view: PlayerView, config: BotConfig = DEFAULT_SETTINGS.bots): number | null {
  const { canBid, minBid } = view.legal;
  if (!canBid || minBid === null || minBid > bidCeiling(view, config)) return null;
  // Takeover ceiling counts on nothing from partner: signal 0, not even the weak-pass reading.
  if (view.highBid?.seat === partnerOf(view.seat)) return bidCeiling(view, config, 0) >= minBid ? minBid : null;
  return minBid;
}

export function overwhelming(view: PlayerView, config: BotConfig = DEFAULT_SETTINGS.bots) {
  return suits.some(s => view.hand.filter(c => suitOf(c) === s).length >= config.shootMinTrump && view.hand.filter(c => suitOf(c) === s && c[0] === 'A').length === 2 && suits.every(side => side === s || view.hand.some(c => suitOf(c) === side && c[0] === 'A')));
}
