import { buildDeck, parseCard, RANK_ORDER } from './deck';
import { trickWinner } from './rules';
import type { CardId, PlayerView, Suit } from './types';

type ClaimView = Pick<PlayerView, 'phase' | 'seat' | 'turn' | 'hand' | 'playedCards' | 'currentTrick' | 'trump'> & {
  /** Cards the claimer knows can never be played: in a solo shoot, the ones it passed back to its sitting-out partner. */
  outOfPlay?: CardId[];
};

/**
 * A sufficient proof using only the leader's hand, public plays and cards it knows are out of play.
 * Hidden ownership, meld and other passes are deliberately irrelevant. Equal ranks cannot beat the
 * card that led the trick. With a seat sitting out, fewer seats reply, so the proof stays sufficient.
 *
 * The claim must hold however the player would actually have led the rest, not just along the best
 * line: someone who leads a side ace before drawing the last trump loses that trick. So EVERY card in
 * the hand must beat EVERY unseen card, as if it were led right now, before any lead had drawn out a
 * suit. Every unseen card stays a possible reply, including a trump on a side lead. This can refuse
 * a claim that careful play would make; it can never approve a hand that some order of leads loses.
 */
export function claimLine(view: ClaimView): CardId[] | null {
  if (view.phase !== 'playing' || view.turn !== view.seat || !view.hand.length || !view.trump
    || !view.currentTrick || view.currentTrick.leader !== view.seat || view.currentTrick.plays.length) return null;
  const trump = view.trump;
  const gone = new Set([...view.hand, ...view.playedCards.map(p => p.card), ...(view.outOfPlay ?? [])]);
  const unseen = buildDeck().filter(card => !gone.has(card));
  const suits: Suit[] = ['S', 'H', 'D', 'C'];
  const replySeat = ((view.seat + 1) % 4) as PlayerView['seat'];
  const beatsAll = (card: CardId) => unseen.every(reply => trickWinner({ leader: view.seat,
    plays: [{ seat: view.seat, card }, { seat: replySeat, card: reply }], winner: null }, trump) === view.seat);
  if (!view.hand.every(beatsAll)) return null;
  // Any order wins; settle trumps first, then by suit and rank, so a claim reads the same every time.
  return [...view.hand].sort((a, b) => {
    const x = parseCard(a), y = parseCard(b);
    return Number(y.suit === trump) - Number(x.suit === trump)
      || suits.indexOf(x.suit) - suits.indexOf(y.suit)
      || RANK_ORDER.indexOf(x.rank) - RANK_ORDER.indexOf(y.rank) || a.localeCompare(b);
  });
}

export const canClaim = (view: ClaimView): boolean => claimLine(view) !== null;
