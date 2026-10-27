import { buildDeck, parseCard, RANK_ORDER } from './deck';
import { trickWinner } from './rules';
import type { CardId, PlayerView, Suit } from './types';

type ClaimView = Pick<PlayerView, 'phase' | 'seat' | 'turn' | 'hand' | 'playedCards' | 'currentTrick' | 'trump'>;

/**
 * A sufficient proof using only the leader's hand and public plays. Hidden ownership, meld and
 * passes are deliberately irrelevant. Equal ranks cannot beat the card that led the trick.
 *
 * On each lead of a suit every holder must follow. Even if all unseen cards of that suit were
 * concentrated in one hand, none can survive min(unseen count, hand size) such leads. Until then
 * we conservatively keep EVERY unseen rank as a possible reply, including a trump on a side lead.
 * This can refuse a claim that deeper inference could prove; it can never approve a losing line.
 */
export function claimLine(view: ClaimView): CardId[] | null {
  if (view.phase !== 'playing' || view.turn !== view.seat || !view.hand.length || !view.trump
    || !view.currentTrick || view.currentTrick.leader !== view.seat || view.currentTrick.plays.length) return null;
  const trump = view.trump;
  const gone = new Set([...view.hand, ...view.playedCards.map(p => p.card)]);
  const unseen = buildDeck().filter(card => !gone.has(card));
  const suits: Suit[] = ['S', 'H', 'D', 'C'];
  const exhausts = Object.fromEntries(suits.map(suit => [suit, Math.min(view.hand.length,
    unseen.filter(card => parseCard(card).suit === suit).length)])) as Record<Suit, number>;
  const leads: Record<Suit, number> = { S: 0, H: 0, D: 0, C: 0 };
  const line = [...view.hand].sort((a, b) => {
    const x = parseCard(a), y = parseCard(b);
    return Number(y.suit === trump) - Number(x.suit === trump)
      || suits.indexOf(x.suit) - suits.indexOf(y.suit)
      || RANK_ORDER.indexOf(x.rank) - RANK_ORDER.indexOf(y.rank) || a.localeCompare(b);
  });
  for (const card of line) {
    const led = parseCard(card).suit;
    const replySeat = ((view.seat + 1) % 4) as PlayerView['seat'];
    for (const reply of unseen) {
      const suit = parseCard(reply).suit;
      if (leads[suit] >= exhausts[suit]) continue;
      if (trickWinner({ leader: view.seat, plays: [{ seat: view.seat, card }, { seat: replySeat, card: reply }], winner: null }, trump) !== view.seat) return null;
    }
    leads[led]++;
  }
  return line;
}

export const canClaim = (view: ClaimView): boolean => claimLine(view) !== null;
