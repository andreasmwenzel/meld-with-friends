import { IllegalAction } from '../types';
import { isPenaltyCard, parseHeartsCard, rankValue } from './deck';
import type { HeartsAction, HeartsCardId, HeartsView } from './types';

const value = (card: HeartsCardId) => rankValue(parseHeartsCard(card).rank);
const suit = (card: HeartsCardId) => parseHeartsCard(card).suit;

function tieBreak(seed: string, card: HeartsCardId): number {
  let hash = 2166136261;
  for (const char of `${seed}:${card}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}

/** A local heuristic using only the same information available to a human. */
export function chooseHeartsAction(view: HeartsView, seed: string): HeartsAction {
  const pick = (cards: HeartsCardId[], score: (card: HeartsCardId) => number) => {
    if (!cards.length) throw new IllegalAction('No legal computer action');
    return [...cards].sort((a, b) => score(b) - score(a) || tieBreak(seed, a) - tieBreak(seed, b) || (a < b ? -1 : a > b ? 1 : 0))[0];
  };
  const countSuit = (card: HeartsCardId) => view.hand.filter(c => suit(c) === suit(card)).length;
  const ownsQueen = view.hand.includes('QS');
  const queenOut = !ownsQueen && !view.playedCards.some(p => p.card === 'QS');
  if (view.legal.mustPassCount !== null) {
    const lowSpades = view.hand.filter(c => suit(c) === 'S' && value(c) < 12).length;
    const remaining = [...view.hand];
    const cards: HeartsCardId[] = [];
    for (let i = 0; i < view.legal.mustPassCount; i++) {
      const card = pick(remaining, c => {
        if (c === 'QS') return countSuit(c) <= 3 ? 1000 : 40;
        if (c === 'AS' || c === 'KS') return ownsQueen && lowSpades >= 3 ? 20 : 900 + value(c);
        if (suit(c) === 'H' && value(c) >= 10) return 700 + value(c);
        if (ownsQueen && lowSpades >= 3 && suit(c) === 'S' && value(c) < 12) return -100;
        if (c === '2C') return -50;
        const left = remaining.filter(other => suit(other) === suit(c)).length;
        return 100 - left * 15 + value(c) * 3;
      });
      cards.push(card);
      remaining.splice(remaining.indexOf(card), 1);
    }
    return { type: 'pass_cards', seat: view.seat, cards };
  }
  if (view.legal.canAdvanceHand) return { type: 'next_hand', seat: view.seat };
  const legal = view.legal.playableCards;
  if (!legal.length) throw new IllegalAction('No legal computer action');
  const plays = view.currentTrick?.plays ?? [];
  let card: HeartsCardId;
  if (!plays.length) {
    card = pick(legal, c => {
      // Draw out the queen with a low spade, without risking the king or ace.
      const safeSpade = queenOut && suit(c) === 'S' && value(c) < 12;
      const risk = suit(c) === 'S' && (c === 'QS' || (queenOut && value(c) > 12));
      return -value(c) + (safeSpade ? 20 : 0) - (risk ? 40 : 0);
    });
  } else if (legal.some(c => suit(c) === suit(plays[0].card))) {
    const led = suit(plays[0].card);
    const highest = Math.max(...plays.filter(p => suit(p.card) === led).map(p => value(p.card)));
    const penalty = plays.some(p => isPenaltyCard(p.card, view.rules));
    const losing = legal.filter(c => value(c) < highest);
    const firstTrick = Object.values(view.tricksTaken).every(count => count === 0);
    if (firstTrick && view.rules.noPointsFirstTrick && !penalty) card = pick(legal, value);
    else if ((penalty || queenOut) && losing.length) card = pick(losing, value);
    else if (penalty || queenOut) card = pick(legal, c => -value(c));
    else card = pick(legal, value);
  } else {
    card = pick(legal, c => {
      if (c === 'QS') return 1000;
      if (suit(c) === 'H') return 800 + value(c);
      if (c === 'AS' || c === 'KS') return 600 + value(c);
      if (c === 'JD' && view.rules.jackOfDiamonds) return -100;
      return 100 - countSuit(c) * 15 + value(c) * 3;
    });
  }
  return { type: 'play_card', seat: view.seat, card };
}
