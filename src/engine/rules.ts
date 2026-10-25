import { parseCard, RANK_ORDER } from './deck';
import type { CardId, PlayConstraint, SeatIndex, Suit, Trick, TrickPlay } from './types';

function beats(candidate: CardId, incumbent: CardId, trump: Suit): boolean {
  const a = parseCard(candidate);
  const b = parseCard(incumbent);
  if (a.suit !== b.suit) return a.suit === trump;
  return RANK_ORDER.indexOf(a.rank) < RANK_ORDER.indexOf(b.rank);
}

function winningPlay(trick: Trick, trump: Suit): TrickPlay {
  if (!trick.plays.length) throw new Error('An empty trick has no winner');
  return trick.plays.reduce((winner, play) => beats(play.card, winner.card, trump) ? play : winner);
}

export function trickWinner(trick: Trick, trump: Suit): SeatIndex {
  return winningPlay(trick, trump).seat;
}

export type { PlayReason, PlayConstraint } from './types';

function constrainedPlays(hand: CardId[], trick: Trick, trump: Suit): { cards: CardId[]; constraint: PlayConstraint } {
  if (!trick.plays.length) return { cards: [...hand], constraint: { reason: 'lead_any', ledSuit: null, mustBeat: null } };
  const ledSuit = parseCard(trick.plays[0].card).suit;
  const following = hand.filter(card => parseCard(card).suit === ledSuit);
  const candidates = following.length ? following : hand.filter(card => parseCard(card).suit === trump);
  if (!candidates.length) return { cards: [...hand], constraint: { reason: 'any', ledSuit, mustBeat: null } };
  const winner = winningPlay(trick, trump).card;
  const heading = candidates.filter(card => beats(card, winner, trump));
  const overtrumping = parseCard(winner).suit === trump && parseCard(candidates[0]).suit === trump;
  const reason = heading.length
    ? overtrumping ? 'must_overtrump' : following.length ? 'must_head' : 'must_trump'
    : following.length ? 'follow_suit' : 'must_trump';
  return {
    cards: heading.length ? heading : candidates,
    constraint: { reason, ledSuit, mustBeat: heading.length && reason !== 'must_trump' ? winner : null },
  };
}

export function legalPlays(hand: CardId[], trick: Trick, trump: Suit): CardId[] {
  return constrainedPlays(hand, trick, trump).cards;
}

export function playConstraint(hand: CardId[], trick: Trick, trump: Suit): PlayConstraint {
  return constrainedPlays(hand, trick, trump).constraint;
}

/** Suit labels may be words or glyphs; card references use the caller's label too. */
export function describeConstraint(c: PlayConstraint, suitNames: Record<Suit, string>): string {
  const suit = c.ledSuit === null ? '' : suitNames[c.ledSuit];
  const card = c.mustBeat === null ? '' : (() => {
    const { rank, suit } = parseCard(c.mustBeat);
    const label = suitNames[suit];
    return `${rank === 'T' ? '10' : rank}${label.length > 1 ? ' ' : ''}${label}`;
  })();
  switch (c.reason) {
    case 'lead_any': case 'any': return 'Any card.';
    case 'follow_suit': return `Follow ${suit}.`;
    case 'must_head': return `You must beat the ${card}.`;
    case 'must_trump': return `No ${suit}: you must trump.`;
    case 'must_overtrump': return c.mustBeat !== null && c.ledSuit === parseCard(c.mustBeat).suit
      ? 'Trump was led: play a higher trump if you can.'
      : `You must beat the ${card}.`;
  }
}
