// Dev tooling: play many full games with random rules and real bots, checking every invariant after every move.
// A failure carries its base state and actions, so it opens in the dev lab exactly as it happened.
import { applyAction, newGame, viewFor } from './game';
import { actors, botAction, checkState } from './scenario';
import type { Action, CardId, GameState, RulesConfig, SeatIndex } from './types';

export interface FuzzFailure { seed: string; rules: Partial<RulesConfig>; error: string; base: GameState; actions: Action[] }

const CARD = /^[ATKQJ9][SHDC][01]$/;
function cardsIn(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (typeof value === 'string') { if (CARD.test(value)) out.add(value); }
  else if (Array.isArray(value)) value.forEach(v => cardsIn(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach(v => cardsIn(v, out));
  return out;
}

/** Cards a seat's view exposes that it has no right to see: other hands before the reveal, or passes it was not part of. */
export function leakedCards(state: GameState, seat: SeatIndex): string[] {
  const s = state as GameState & { playedCards?: { card: CardId }[]; passedOut?: Record<SeatIndex, CardId[]>; passedIn?: Record<SeatIndex, CardId[]> };
  const view = viewFor(state, seat);
  const allowed = new Set<string>([
    ...state.players[seat].hand,
    ...(s.playedCards ?? []).map(p => p.card),
    ...state.tricksTaken.red.flat(), ...state.tricksTaken.blue.flat(),
    ...(state.currentTrick?.plays.map(p => p.card) ?? []),
    ...state.players.flatMap(p => p.meld.flatMap(m => m.cards)),
    ...(s.passedOut?.[seat] ?? []), ...(s.passedIn?.[seat] ?? []),
  ]);
  // A thrown-in hand is shown to the whole table on purpose; the old deal's cards are not this deal's.
  const { revealed, ...rest } = { ...view, misdeal: null };
  if (revealed && !(state.rules.revealHands && (state.phase === 'hand_over' || state.phase === 'game_over'))) return ['revealed hands outside the reveal'];
  return [...cardsIn(rest)].filter(card => !allowed.has(card));
}

function pick<T>(seed: number, options: readonly T[]): T { return options[Math.abs(seed) % options.length]; }

/** Rules spread over the settings tables actually use, varied by seed. */
export function fuzzRules(n: number): Partial<RulesConfig> {
  const scoring = n % 2 ? 'classic' : 'modern';
  const unit = scoring === 'modern' ? 1 : 10;
  return {
    scoring,
    target: pick(n, [50, 100, 150]) * unit, minBid: pick(n >> 2, [15, 25]) * unit, bidStep: pick(n >> 3, [1, 2]) * unit,
    passCount: pick(n >> 4, [0, 3, 4, 5]), counting: scoring === 'classic' ? pick(n >> 5, ['tens', 'classic'] as const) : 'tens',
    shoot: pick(n >> 6, ['off', 'game', 'points'] as const), shootPoints: 50 * unit,
    dealerStuck: pick(n >> 7, [true, false]), mustTakeTrickToSaveMeld: pick(n >> 8, [true, false]),
    ninesMisdeal: pick(n >> 14, [true, false]),
    ...(n >> 9) % 3 === 0 ? {
      // Rarer settings, about a third of games: long passes, no last-trick bonus, odd counter values, hidden hands.
      passCount: pick(n >> 10, [6, 8, 12]), lastTrickBonus: pick(n >> 11, [0, 1, 2]) * unit,
      counterValue: pick(n >> 12, [1, 2, 3]) * unit, revealHands: pick(n >> 13, [true, false]),
    } : {},
  };
}

export function fuzz(games: number, prefix = 'fuzz', maxActions = 3000): { played: number; actions: number; failures: FuzzFailure[] } {
  const failures: FuzzFailure[] = [];
  let total = 0;
  for (let i = 0; i < games; i++) {
    const seed = `${prefix}:${i}`;
    const rules = fuzzRules(i * 2654435761 >>> 0);
    const base = newGame(seed, rules, (i % 4) as 0 | 1 | 2 | 3);
    let state = base;
    const actions: Action[] = [];
    try {
      while (state.phase !== 'game_over' && actions.length < maxActions) {
        const seat = state.phase === 'hand_over' ? 0 : actors(state)[0];
        if (seat === undefined) throw new Error(`Nobody can act in ${state.phase}`);
        const action = state.phase === 'hand_over' ? { type: 'next_hand', seat } as Action : botAction(state, seat);
        state = applyAction(state, action);
        actions.push(action);
        const problems = checkState(state);
        for (const seat of [0, 1, 2, 3] as const) {
          const leaked = leakedCards(state, seat);
          if (leaked.length) problems.push(`Seat ${seat} can see ${leaked.join(' ')} in ${state.phase}`);
        }
        if (problems.length) throw new Error(problems.join('; '));
      }
      if (state.phase !== 'game_over') throw new Error(`No winner after ${maxActions} actions`);
    } catch (e) {
      failures.push({ seed, rules, error: (e as Error).message, base, actions });
    }
    total += actions.length;
  }
  return { played: games, actions: total, failures };
}
