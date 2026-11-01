import { computeMeld } from '../meld';
import type { CardId, PlayerView } from '../types';
import { strength, suitOf, suits } from './shared';

const pinochlePiece = (c: CardId) => c.startsWith('QS') || c.startsWith('JD');
const pinochles = (cards: CardId[]) => Math.min(cards.filter(c => c.startsWith('QS')).length, cards.filter(c => c.startsWith('JD')).length);
// A judgement call: length plus control of most higher cards may promote an off-suit piece.
const PINOCHLE_PROMOTION = { maxOutstandingHigher: 2, minSuitLength: 5 };

/** Compare complete passes so a marriage or pinochle can travel together. Ties use card IDs. */
function bestPass(hand: CardId[], count: number, score: (passed: CardId[], kept: CardId[]) => number[]) {
  let best: CardId[] = [], bestScore: number[] | undefined;
  const selected: CardId[] = [];
  const visit = (start: number) => {
    if (selected.length === count) {
      const passed = new Set(selected);
      const candidate = score(selected, hand.filter(c => !passed.has(c)));
      const difference = bestScore ? candidate.findIndex((n, i) => n !== bestScore![i]) : -1;
      if (!bestScore || (difference >= 0 && candidate[difference] > bestScore[difference])) {
        best = [...selected]; bestScore = candidate;
      }
      return;
    }
    for (let i = start; i <= hand.length - (count - selected.length); i++) {
      selected.push(hand[i]); visit(i + 1); selected.pop();
    }
  };
  visit(0);
  return best;
}

export function choosePass(view: PlayerView) {
  const hand = [...new Set(view.hand)].sort();
  const count = view.legal.mustPassCount!;
  const meld = new Set(computeMeld(hand, view.trump!, view.rules).items.flatMap(m => m.cards));
  const splitPinochle = (passed: CardId[], kept: CardId[]) => pinochles(hand) - pinochles(kept) - pinochles(passed);
  const value = (c: CardId) => (suitOf(c) === view.trump ? 100 : 0) + (c[0] === 'A' ? 60 : 0)
    + (meld.has(c) ? 30 : 0) + (pinochlePiece(c) ? 12 : 0) + strength(c);
  if (view.phase !== 'passing_to_bidder') {
    const pieces = hand.filter(pinochlePiece);
    const promotable = (piece: CardId) => {
      const suit = hand.filter(c => suitOf(c) === suitOf(piece));
      const higherRanks = piece[0] === 'Q' ? 'ATK' : 'ATKQ';
      const outstanding = higherRanks.length * 2 - suit.filter(c => higherRanks.includes(c[0])).length;
      return outstanding <= PINOCHLE_PROMOTION.maxOutstandingHigher && suit.length >= PINOCHLE_PROMOTION.minSuitLength;
    };
    const returnPieces = (view.trump === 'H' || view.trump === 'C') && pinochles(hand) !== 2
      && pieces.some(c => !promotable(c));
    const returnValue = (c: CardId) => value(c)
      - (suitOf(c) !== view.trump && 'KQ'.includes(c[0]) && !meld.has(c) && !pinochlePiece(c) ? 5 : 0)
      - (returnPieces && pinochlePiece(c) ? 1000 : 0);
    // Only the at-most-four pinochle pieces interact. Fill each candidate with
    // the cheapest ordinary cards instead of enumerating a 24-card return hand.
    const ordinary = hand.filter(c => !pinochlePiece(c))
      .sort((a, b) => returnValue(a) - returnValue(b) || a.localeCompare(b));
    let best: CardId[] = [], bestScore: number[] | undefined;
    for (let mask = 0; mask < 2 ** pieces.length; mask++) {
      const selected = pieces.filter((_, i) => mask & (1 << i));
      const needed = count - selected.length;
      if (needed < 0 || needed > ordinary.length) continue;
      const passed = [...selected, ...ordinary.slice(0, needed)];
      const kept = hand.filter(c => !passed.includes(c));
      const score = [
        -splitPinochle(passed, kept),
        // A double must stay in one hand; only give it up when the pass size forces it.
        -(pinochles(hand) === 2 ? selected.length : 0),
        -passed.reduce((n, c) => n + returnValue(c), 0),
      ];
      const difference = bestScore ? score.findIndex((n, i) => n !== bestScore![i]) : -1;
      if (!bestScore || (difference >= 0 && score[difference] > bestScore[difference])) {
        best = passed; bestScore = score;
      }
    }
    return best.sort((a, b) => returnValue(a) - returnValue(b) || a.localeCompare(b));
  }

  // At most 924 four-card passes from a twelve-card partner hand.
  const trumps = hand.filter(c => suitOf(c) === view.trump).sort((a, b) => strength(b) - strength(a) || a.localeCompare(b));
  const pairs = (cards: CardId[], suit: string) => Math.min(
    cards.filter(c => c[0] === 'K' && c[1] === suit).length,
    cards.filter(c => c[0] === 'Q' && c[1] === suit).length);
  const best = bestPass(hand, count, (passed, kept) => [
    -splitPinochle(passed, kept),
    ...trumps.map(c => Number(passed.includes(c))),
    passed.filter(c => c[0] === 'A').length,
    -suits.reduce((n, suit) => n + pairs(hand, suit) - pairs(kept, suit) - pairs(passed, suit), 0),
    computeMeld(kept, view.trump!, view.rules).items
      .filter(m => m.kind !== 'pinochle' && m.kind !== 'double_pinochle').reduce((n, m) => n + m.points, 0),
    passed.reduce((n, c) => n + strength(c) + (pinochlePiece(c) ? 12 : 0), 0),
  ]);
  const sendValue = (c: CardId) => (suitOf(c) === view.trump ? 100 : 0) + (c[0] === 'A' ? 60 : 0)
    + (pinochlePiece(c) ? 12 : 0) + strength(c);
  return best.sort((a, b) => sendValue(b) - sendValue(a) || a.localeCompare(b));
}
