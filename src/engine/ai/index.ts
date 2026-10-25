import { DEFAULT_SETTINGS, type BotConfig } from '../../lib/settings';
import type { Action, PlayerView } from '../types';
import { computeMeld } from '../meld';
import { bestTrump, overwhelming, projectedValue } from './bid';
import { choosePass } from './pass';
import { choosePlay } from './play';
export function chooseAction(view: PlayerView, options: { budgetMs?: number; seed?: string; config?: Partial<BotConfig> } = {}): Action {
  const config = { ...DEFAULT_SETTINGS.bots, ...options.config };
  const { legal: l, seat }=view;
  if (l.canAdvanceHand) return {type:'next_hand',seat};
  if (l.canShoot && overwhelming(view, config)) return {type:'shoot',seat};
  if (l.canPassBid) {
    const ceiling=Math.floor((projectedValue(view,bestTrump(view, config), config)-config.bidMargin)/view.rules.bidStep)*view.rules.bidStep;
    return l.canBid && l.minBid!<=ceiling ? {type:'bid',seat,amount:l.minBid!} : {type:'pass_bid',seat};
  }
  if (l.canDeclareTrump) return {type:'declare_trump',seat,suit:bestTrump(view, config)};
  if (l.mustPassCount!==null) return {type:'pass_cards',seat,cards:choosePass(view)};
  if (l.canDeclareMeld && view.trump) {
    const full = computeMeld(view.hand, view.trump);
    const declared = view.melds[seat].reduce((total, item) => total + item.points, 0);
    const handLog = view.log.slice(view.log.findLastIndex(line => line.startsWith(`Hand ${view.handNumber}:`)));
    const declaredZero = handLog.includes(`${['South', 'West', 'North', 'East'][seat]} melds 0`);
    if (full.total !== declared || (!full.total && !declaredZero)) return { type: 'declare_meld', seat, cards: [...view.hand] };
  }
  if (l.canConfirmMeld) return {type:'confirm_meld',seat};
  if (l.playableCards.length) return {type:'play_card',seat,card:choosePlay(view,{ ...options, config })};
  throw new Error('No legal action for this seat');
}
