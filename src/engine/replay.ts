// Game replay: rebuild a game from its action log, cut it at the last completed hand, and strip
// everything a browser could use to deal the hand still in progress. Pure; no I/O.
import { cardLabel } from './deck';
import { applyAction, newGame } from './game';
import type { Action, CardId, GameState, HandRecord, SeatIndex, Suit, Trick } from './types';

/** One logged action. `state` is present when the action dealt new cards (next hand or a redeal): the
 *  client cannot deal without the seed, so it takes the dealt position from here instead. */
export interface ReplayStep { action: Action; state?: GameState }

export interface Replay {
  version: 1;
  /** position after the first deal, seed removed */
  start: GameState;
  steps: ReplayStep[];
  /** hands fully contained in the replay; a hand still being played is left out */
  hands: number;
  finished: boolean;
}

export interface ReplaySeat { seat: SeatIndex; name: string; bot: boolean }
/** What `/api/replay/[id]` returns. */
export interface ReplayPayload extends Replay {
  gameId: string; code: string; seats: ReplaySeat[];
  /** where the signed-in reader sat, so the board can face them; null for anyone else */
  viewerSeat: SeatIndex | null;
  startedAt: string; finishedAt: string | null;
}

const SEATS: readonly SeatIndex[] = [0, 1, 2, 3];
/** Key-sorted JSON; Postgres jsonb does not keep key order. */
const canonical = (value: unknown): string => JSON.stringify(value, (_k, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);

function sameGame(a: GameState, b: GameState): boolean {
  return a.rev === b.rev && a.phase === b.phase && a.handNumber === b.handNumber
    && canonical(a.players) === canonical(b.players) && canonical(a.score) === canonical(b.score);
}

/**
 * Finds the opening position whose replay of `actions` reaches `final`. Hand one opens with the seat
 * after the dealer, so the first logged action names the dealer; the other seats are tried in case
 * an older game disagrees. Returns null when the log no longer replays, for example after an engine change.
 */
export function rebuildFromLog(final: GameState, actions: Action[]): { start: GameState; states: GameState[]; actions: Action[] } | null {
  const first = actions[0]?.seat;
  const guess = first === undefined ? 0 : ((first + 3) % 4) as SeatIndex;
  const dealers = [guess, ...SEATS.filter(seat => seat !== guess)];
  for (const dealer of dealers) {
    try {
      const start = newGame(final.seed, final.rules, dealer);
      const played = replayLog(start, actions, final);
      // Each decision the older log lacks adds a revision the stored game never had.
      const added = played.actions.length - actions.length;
      const last = played.states[played.states.length - 1];
      if (sameGame({ ...last, rev: last.rev - added }, final)) return { start, ...played };
    } catch { /* try the next dealer */ }
  }
  return null;
}

/**
 * Applies a logged action list from `start`. Games logged before the bidder's shoot decision after
 * the pass existed went straight to meld, so where the log moves on without a decision the bidder is
 * taken to have played it out. So is a log that ends on the pass into meld when the stored game
 * (`final`, if given) is no longer waiting on the decision. Returns every state and the actions
 * actually applied; each inserted decision adds a revision the stored game never had.
 */
export function replayLog(start: GameState, actions: readonly Action[], final?: Pick<GameState, 'phase'>): { states: GameState[]; actions: Action[] } {
  const states = [start];
  const applied: Action[] = [];
  const apply = (action: Action) => { states.push(applyAction(states[states.length - 1], action)); applied.push(action); };
  const declineIfSkipped = (next?: Action) => {
    const at = states[states.length - 1];
    if (at.phase === 'deciding_shoot' && at.bidder !== null && next?.type !== 'shoot' && next?.type !== 'decline_shoot') {
      apply({ type: 'decline_shoot', seat: at.bidder });
    }
  };
  for (const action of actions) {
    declineIfSkipped(action);
    apply(action);
  }
  if (final && final.phase !== 'deciding_shoot') declineIfSkipped();
  return { states, actions: applied };
}

/** The state without its seed, so nobody can deal the next hand from it. */
const sealed = (state: GameState): GameState => ({ ...state, seed: '', log: [] });

/**
 * Packs a replayed game for a browser. Only hands that reached `hand_over` are included; the hand in
 * progress and its deal stay on the server. Returns null when no hand is complete yet.
 */
export function buildReplay(states: readonly GameState[], actions: readonly Action[]): Replay | null {
  const final = states[states.length - 1];
  const finished = final.phase === 'game_over';
  let cut = actions.length;
  if (!finished) {
    cut = -1;
    for (let i = states.length - 1; i >= 1; i--) if (states[i].phase === 'hand_over') { cut = i; break; }
    if (cut < 0) return null;
  }
  const steps: ReplayStep[] = [];
  for (let i = 0; i < cut; i++) {
    const before = states[i], after = states[i + 1];
    steps.push(after.handNumber !== before.handNumber ? { action: actions[i], state: sealed(after) } : { action: actions[i] });
  }
  return { version: 1, start: sealed(states[0]), steps, hands: states[cut].history.length, finished };
}

/** Every position in a replay: index 0 is the opening deal, index i the position after step i. */
export function expandReplay(replay: Replay): GameState[] {
  const frames = [replay.start];
  for (const step of replay.steps) frames.push(step.state ?? applyAction(frames[frames.length - 1], step.action));
  return frames;
}

export const SUIT_WORD: Record<Suit, string> = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' };
const SUIT_SIGN: Record<Suit, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };

/** One line for a step, given the positions before and after it. */
export function describeStep(action: Action, before: GameState, after: GameState, nameOf: (seat: SeatIndex) => string): string {
  const who = nameOf(action.seat);
  switch (action.type) {
    case 'bid': return `${who} bids ${action.amount}`;
    case 'shoot': return before.phase === 'deciding_shoot' ? `${who} shoots the moon after the pass` : `${who} shoots the moon`;
    case 'decline_shoot': return `${who} plays it out`;
    case 'misdeal': return `${who} throws in ${before.players[action.seat].hand.filter(card => card[0] === '9').length} nines and no meld, so ${nameOf(after.dealer)} redeals`;
    case 'pass_bid': {
      if (after.handNumber !== before.handNumber) return `${who} passes. Everyone passed, so ${nameOf(after.dealer)} redeals`;
      if (after.bidder !== null && before.bidder === null && after.highBid) {
        return after.bids.every(bid => bid.amount === null)
          ? `${who} passes. ${nameOf(after.dealer)} is stuck with ${after.highBid.amount}`
          : `${who} passes. ${nameOf(after.bidder)} takes it at ${after.highBid.shoot ? 'the moon' : after.highBid.amount}`;
      }
      return `${who} passes`;
    }
    case 'declare_trump': return `${who} names ${SUIT_WORD[action.suit]} trump`;
    case 'pass_cards': {
      const to = before.phase === 'passing_to_bidder' ? before.bidder : before.bidder === null ? null : ((before.bidder + 2) % 4) as SeatIndex;
      return `${who} passes ${action.cards.map(cardLabel).join(' ')}${to === null ? '' : ` to ${nameOf(to)}`}`;
    }
    case 'declare_meld': return `${who} lays down ${after.players[action.seat].meldPoints} in meld`;
    case 'confirm_meld': {
      const points = after.players[action.seat].meldPoints;
      const line = points > 0 ? `${who} melds ${points}` : `${who} has no meld`;
      return after.phase === 'playing' ? `${line}. ${nameOf(after.turn!)} leads` : line;
    }
    case 'play_card': {
      const line = `${who} plays ${cardLabel(action.card)}`;
      const winner = before.currentTrick?.plays.length === 3 ? trickWinnerOf(after) : null;
      if (winner === null) return line;
      const record = after.history.length > before.history.length ? after.history[after.history.length - 1] : null;
      return `${line}. ${nameOf(winner)} takes the trick${record ? `. ${handOutcome(record, nameOf)}` : ''}`;
    }
    case 'next_hand': return `Hand ${after.handNumber}: ${nameOf(after.dealer)} deals`;
  }
}

/** The engine keeps the last completed trick, with its winner, beside the public state. */
function trickWinnerOf(state: GameState): SeatIndex | null {
  return (state as GameState & { lastTrick?: Trick | null }).lastTrick?.winner ?? null;
}

/** "North made 32 in ♠" or "North went set on 40", with what each side scored or lost. */
export function handOutcome(record: HandRecord, nameOf: (seat: SeatIndex) => string): string {
  const who = nameOf(record.bidder);
  const change = (team: string, n: number) => n < 0 ? `${team} loses ${-n}` : `${team} scores ${n}`;
  const totals = `${change('Red', record.delta.red)}, ${change('Blue', record.delta.blue)}`;
  if (record.shotMade !== undefined) return `${who} ${record.shotMade ? 'shot the moon' : 'missed the moon'}. ${totals}`;
  return `${who} ${record.wentSet ? `went set on ${record.bid}` : `made ${record.bid}`} in ${SUIT_SIGN[record.trump]}. ${totals}`;
}

/** Cards a step touched, for lighting them on the board: the card played, the cards passed, or the meld laid down. */
export function cardsOfStep(action: Action, after: GameState): CardId[] {
  switch (action.type) {
    case 'play_card': return [action.card];
    case 'pass_cards': return action.cards;
    case 'declare_meld': return [...new Set(after.players[action.seat].meld.flatMap(item => item.cards))];
    case 'confirm_meld': return [...new Set(after.players[action.seat].meld.flatMap(item => item.cards))];
    default: return [];
  }
}
