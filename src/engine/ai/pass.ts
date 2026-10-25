import { computeMeld } from '../meld';
import type { PlayerView } from '../types';
import { strength, suitOf } from './shared';
export function choosePass(view: PlayerView) {
  const meld = new Set(computeMeld(view.hand, view.trump!).items.flatMap(m => m.cards));
  const value = (c: typeof view.hand[number]) => (suitOf(c) === view.trump ? 100 : 0) + (c[0] === 'A' ? 60 : 0) + (meld.has(c) ? 30 : 0) + ((c.startsWith('QS') || c.startsWith('JD')) ? 12 : 0) + strength(c);
  const direction = view.phase === 'passing_to_bidder' ? -1 : 1;
  return [...view.hand].sort((a,b) => direction * (value(a)-value(b)) || a.localeCompare(b)).slice(0, view.legal.mustPassCount!);
}
