// The public part of a move, broadcast on the table channel so seated clients can update their view
// without fetching it. The channel is open to anyone with the table code, so a move carries only what
// every seat already sees, and moves that change anything private (a deal, passing, the reveal) are
// not described at all: clients fetch their view for those.
import { legalActionsFor, viewFor } from './game';
import type { Action, CardId, GameState, HandRecap, PlayerView, SeatIndex, Suit } from './types';

const SEATS = [0, 1, 2, 3] as const;
const LOG_CAP = 50;

/** What a move said, without anything private (a meld declaration's chosen cards are left out). */
export type PublicAction =
  | { type: 'bid'; seat: SeatIndex; amount: number }
  | { type: 'pass_bid' | 'shoot' | 'decline_shoot' | 'declare_meld' | 'confirm_meld'; seat: SeatIndex }
  | { type: 'declare_trump'; seat: SeatIndex; suit: Suit }
  | { type: 'play_card'; seat: SeatIndex; card: CardId };

/** Fields of a view that differ between seats; they never travel in a move. */
type PrivateKey = 'seat' | 'hand' | 'legal' | 'revealed';
type PublicRecap = Omit<HandRecap, 'myPassedOut' | 'myPassedIn'>;
export type PublicPatch = Partial<Omit<PlayerView, PrivateKey | 'recap' | 'log' | 'rev'>> & { recap?: PublicRecap };

export interface PublicMove {
  /** the revision this move produced; it applies only to a view at rev - 1 */
  rev: number;
  action: PublicAction;
  /** public view fields this move changed, with their new values */
  patch: PublicPatch;
  /** log lines this move added */
  log: string[];
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function publicAction(action: Action): PublicAction | null {
  switch (action.type) {
    case 'bid': return { type: 'bid', seat: action.seat, amount: action.amount };
    case 'pass_bid': case 'shoot': case 'decline_shoot': case 'declare_meld': case 'confirm_meld': return { type: action.type, seat: action.seat };
    case 'declare_trump': return { type: 'declare_trump', seat: action.seat, suit: action.suit };
    case 'play_card': return { type: 'play_card', seat: action.seat, card: action.card };
    case 'concede': return null; // Hand-end reveals require each seat to fetch its view.
    default: return null;
  }
}

function publicRecap(recap: HandRecap): PublicRecap {
  const rest: Partial<HandRecap> = { ...recap };
  delete rest.myPassedOut; delete rest.myPassedIn;
  return rest as PublicRecap;
}

/**
 * Describe `action`, which took `prev` to `next`, for the table channel; null when clients must fetch
 * instead. Only moves within a hand qualify, and only if no seat's private view changes beyond the
 * mover losing the card it played.
 */
export function publicMove(prev: GameState, next: GameState, action: Action): PublicMove | null {
  const said = publicAction(action);
  if (!said || next.rev !== prev.rev + 1 || next.handNumber !== prev.handNumber) return null;
  if (next.phase === 'hand_over' || next.phase === 'game_over') return null;
  const before = SEATS.map(seat => viewFor(prev, seat));
  const after = SEATS.map(seat => viewFor(next, seat));
  for (const seat of SEATS) {
    const a = before[seat], b = after[seat];
    const hand = said.type === 'play_card' && said.seat === seat ? a.hand.filter(card => card !== said.card) : a.hand;
    if (!same(b.hand, hand) || b.revealed !== null || !same(a.recap.myPassedOut, b.recap.myPassedOut) || !same(a.recap.myPassedIn, b.recap.myPassedIn)) return null;
  }
  // The patch is read from one seat's view, so everything outside the private fields must be the same
  // for every seat; otherwise that seat's private information could travel in the broadcast.
  const shared = after.map(sharedFields);
  if (shared.some(fields => !same(fields, shared[0]))) return null;
  const a = before[0], b = after[0];
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(b) as (keyof PlayerView)[]) {
    if (key === 'seat' || key === 'hand' || key === 'legal' || key === 'revealed' || key === 'recap' || key === 'log' || key === 'rev') continue;
    if (!same(a[key], b[key])) patch[key] = b[key];
  }
  const recap = publicRecap(b.recap);
  if (!same(publicRecap(a.recap), recap)) patch.recap = recap;
  // The log keeps its last 50 lines: find the new lines that, appended, give the new log.
  let log: string[] | null = null;
  for (let n = 0; n <= b.log.length && log === null; n++) {
    const added = b.log.slice(b.log.length - n);
    if (same([...a.log, ...added].slice(-LOG_CAP), b.log)) log = added;
  }
  if (log === null) return null;
  const move: PublicMove = { rev: next.rev, action: said, patch: patch as PublicPatch, log };
  // Each client works out its own legal actions from its view. Some depend on what only the server
  // holds (a shooter's claim remembers the cards it passed back), so when any seat would get them
  // wrong, there is no public move and every client fetches its view instead.
  if (SEATS.some(seat => !same(applyPublicMove(before[seat], move)?.legal, after[seat].legal))) return null;
  return move;
}

/** A view without the fields that differ between seats. */
function sharedFields(view: PlayerView): Record<string, unknown> {
  const rest: Record<string, unknown> = { ...view, recap: publicRecap(view.recap) };
  for (const key of ['seat', 'hand', 'legal', 'revealed'] satisfies PrivateKey[]) delete rest[key];
  return rest;
}

/** Enough of a game state to work out one seat's legal actions from its own view. */
function stateFromView(view: PlayerView): GameState & Pick<PlayerView, 'playedCards'> {
  return {
    version: 1, rules: view.rules, phase: view.phase, handNumber: view.handNumber, dealer: view.dealer, turn: view.turn,
    players: SEATS.map(seat => ({
      seat, hand: seat === view.seat ? view.hand : [], meld: view.melds[seat], meldPoints: view.recap.melds[seat]?.points ?? 0,
      meldConfirmed: view.meldConfirmed[seat], passBuffer: [],
    })) as unknown as GameState['players'],
    sittingOut: view.sittingOut, bids: view.bids, highBid: view.highBid, bidder: view.bidder, trump: view.trump, currentTrick: view.currentTrick,
    tricksTaken: { red: Array.from({ length: view.trickCounts.red }, () => []), blue: Array.from({ length: view.trickCounts.blue }, () => []) }, score: view.score, history: [], winner: view.winner, seed: '', rev: view.rev, log: [],
    playedCards: view.playedCards,
  };
}

/**
 * Apply a broadcast move to this seat's view. Null when it does not follow on from this view
 * (a missed or out-of-order event), so the caller fetches the view instead.
 */
export function applyPublicMove<V extends PlayerView>(view: V, move: PublicMove): V | null {
  if (move.rev !== view.rev + 1) return null;
  let hand = view.hand;
  if (move.action.type === 'play_card' && move.action.seat === view.seat) {
    const card = move.action.card;
    if (!hand.includes(card)) return null;
    hand = hand.filter(c => c !== card);
  }
  const { recap, ...rest } = move.patch;
  const next: V = {
    ...view, ...rest, hand, rev: move.rev,
    recap: recap ? { ...recap, myPassedOut: view.recap.myPassedOut, myPassedIn: view.recap.myPassedIn } : view.recap,
    log: [...view.log, ...move.log].slice(-LOG_CAP),
  };
  next.legal = legalActionsFor(stateFromView(next), view.seat);
  return next;
}
