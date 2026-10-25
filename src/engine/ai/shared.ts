import type { CardId, Rank, RulesConfig, SeatIndex, Suit } from '../types';
export const suits: Suit[] = ['S', 'H', 'D', 'C'];
export const seats: SeatIndex[] = [0, 1, 2, 3];
export const ranks = 'ATKQJ9';
export const strength = (card: CardId) => 6 - ranks.indexOf(card[0]);
export const suitOf = (card: CardId) => card[1] as Suit;
export const team = (seat: SeatIndex) => seat % 2 === 0 ? 'red' : 'blue';
export function points(card: CardId, rules: RulesConfig) {
  return rules.counting === 'classic' ? ({ A: 11, T: 10, K: 4, Q: 3, J: 2, '9': 0 }[card[0] as Rank]) : 'ATK'.includes(card[0]) ? rules.counterValue : 0;
}
export function random(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => { h += 0x6d2b79f5; let t = Math.imul(h ^ h >>> 15, h | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
