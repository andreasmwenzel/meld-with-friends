import type { CardId, Rank, Suit } from './types';

export const RANK_ORDER: readonly Rank[] = ['A', 'T', 'K', 'Q', 'J', '9'];
export const SUITS: readonly Suit[] = ['S', 'H', 'D', 'C'];

export function buildDeck(): CardId[] {
  return SUITS.flatMap(suit => RANK_ORDER.flatMap(rank =>
    [0, 1].map(copy => `${rank}${suit}${copy}` as CardId)));
}

export function parseCard(id: CardId): { rank: Rank; suit: Suit; copy: 0 | 1 } {
  if (!/^[ATKQJ9][SHDC][01]$/.test(id)) throw new Error(`Invalid card: ${id}`);
  return { rank: id[0] as Rank, suit: id[1] as Suit, copy: Number(id[2]) as 0 | 1 };
}

export function cardLabel(id: CardId): string {
  const { rank, suit } = parseCard(id);
  return `${rank === 'T' ? '10' : rank}${{ S: '♠', H: '♥', D: '♦', C: '♣' }[suit]}`;
}

/** FNV-1a seed hashing followed by mulberry32 and Fisher-Yates. */
export function seededShuffle(cards: readonly CardId[], seed: string): CardId[] {
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
