import type { HeartsCardId, HeartsRules, StdRank, Suit } from './types';

export const HEARTS_RANKS: readonly StdRank[] = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const SUITS: readonly Suit[] = ['C', 'D', 'S', 'H'];

export function rankValue(rank: StdRank): number {
  return HEARTS_RANKS.indexOf(rank) + 2;
}

export function buildHeartsDeck(): HeartsCardId[] {
  return SUITS.flatMap(suit => HEARTS_RANKS.map(rank => `${rank}${suit}` as HeartsCardId));
}

export function parseHeartsCard(id: HeartsCardId): { rank: StdRank; suit: Suit } {
  if (typeof id !== 'string' || !/^[2-9TJQKA][CDSH]$/.test(id)) throw new Error(`Invalid card: ${id}`);
  return { rank: id[0] as StdRank, suit: id[1] as Suit };
}

export function heartsCardLabel(id: HeartsCardId): string {
  const { rank, suit } = parseHeartsCard(id);
  return `${rank === 'T' ? '10' : rank}${{ C: '♣', D: '♦', S: '♠', H: '♥' }[suit]}`;
}

/** Penalties are positive points; the optional diamond jack is a bonus. */
export function isPenaltyCard(id: HeartsCardId, rules: HeartsRules): boolean {
  return cardPoints(id, rules) > 0;
}

export function cardPoints(id: HeartsCardId, rules: HeartsRules): number {
  const { suit } = parseHeartsCard(id);
  return suit === 'H' ? 1 : id === 'QS' ? 13 : id === 'JD' && rules.jackOfDiamonds ? -10 : 0;
}

export function sortHeartsHand(hand: readonly HeartsCardId[]): HeartsCardId[] {
  return [...hand].sort((a, b) => {
    const left = parseHeartsCard(a), right = parseHeartsCard(b);
    return SUITS.indexOf(left.suit) - SUITS.indexOf(right.suit) || rankValue(left.rank) - rankValue(right.rank);
  });
}

/** FNV-1a seed hashing followed by mulberry32 and Fisher-Yates. */
export function seededHeartsShuffle(cards: readonly HeartsCardId[], seed: string): HeartsCardId[] {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
  const random = () => {
    hash = (hash + 0x6d2b79f5) | 0;
    let t = Math.imul(hash ^ (hash >>> 15), 1 | hash);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const result = [...cards];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
