// Dev tooling: play many full games with random rules and real bots, checking every invariant after every move.
// A failure carries its base state and actions, so it opens in the dev lab exactly as it happened.
import { applyAction, newGame, viewFor } from './game';
import { random } from './ai/shared';
import { actors, botAction, checkState } from './scenario';
import { claimLine } from './claim';
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
  const { revealed, claim, ...rest } = { ...view, misdeal: null };
  if (revealed && !(state.rules.revealHands && (state.phase === 'hand_over' || state.phase === 'game_over'))) return ['revealed hands outside the reveal'];
  if (claim && !['hand_over', 'game_over'].includes(state.phase)) return ['claimed hands before hand over'];
  const seen = cardsIn(rest);
  const hidden = state.sittingOut != null && !['hand_over', 'game_over'].includes(state.phase)
    ? state.players[state.sittingOut].hand : [];
  return [...seen].filter(card => !allowed.has(card) || hidden.includes(card as CardId));
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
    shoot: pick(n >> 6, ['off', 'on'] as const),
    dealerStuck: pick(n >> 7, [true, false]), mustTakeTrickToSaveMeld: pick(n >> 8, [true, false]),
    ninesMisdeal: pick(n >> 14, [true, false]),
    ...(n >> 9) % 3 === 0 ? {
      // Rarer settings, about a third of games: long passes, no last-trick bonus, odd counter values, hidden hands.
      passCount: pick(n >> 10, [6, 8, 12]), lastTrickBonus: pick(n >> 11, [0, 1, 2]) * unit,
      counterValue: pick(n >> 12, [1, 2, 3]) * unit, revealHands: pick(n >> 13, [true, false]),
    } : {},
  };
}

/** Bots rarely hold a hand to shoot with, so at the decision after the pass the fuzzer shoots about one time in ten. */
function fuzzAction(state: GameState, seat: SeatIndex): Action {
  if (state.phase === 'deciding_shoot' && random(`${state.seed}:${state.rev}`)() < 0.1) return { type: 'shoot', seat };
  return botAction(state, seat);
}

/** Exhaust every reply with up to three cards per seat; otherwise try 32 seeded opposing lines.
 * The claimer follows the proven line; every other seat is free to choose ANY legal reply.
 */
export function verifyClaim(state: GameState, seed: string): number {
  if (state.turn === null) return 0;
  const seat = state.turn;
  const view = viewFor(state, seat);
  if (!view.legal.canClaim) return 0;
  const line = claimLine(view);
  if (!line) return 0;
  const claimed = applyAction(state, { type: 'claim', seat });
  const before = viewFor(state, seat).recap.tricks.length;
  let playouts = 0;
  const assert = (played: GameState) => {
    const view = viewFor(played, seat);
    if (view.recap.tricks.slice(before).some(trick => trick.winner !== seat)) throw new Error('A proven claimer lost a trick');
    for (const key of ['history', 'score', 'winner', 'phase'] as const) {
      if (JSON.stringify(played[key]) !== JSON.stringify(claimed[key])) throw new Error(`Claim and playout disagree on ${key}`);
    }
    if (view.recap.tricks.length !== 12 || played.players.some(p => p.hand.length)) throw new Error('Claim playout did not finish all twelve tricks');
    playouts++;
  };
  const walk = (at: GameState) => {
    if (at.phase !== 'playing') { assert(at); return; }
    const who = at.turn!;
    const view = viewFor(at, who);
    const cards = who === seat ? [line[view.recap.tricks.length - before]] : view.legal.playableCards;
    for (const card of cards) walk(applyAction(at, { type: 'play_card', seat: who, card }));
  };
  if (line.length <= 3) walk(state);
  else {
    const rng = random(seed);
    for (let trial = 0; trial < 32; trial++) {
      let at = state;
      while (at.phase === 'playing') {
        const who = at.turn!;
        const view = viewFor(at, who);
        const cards = view.legal.playableCards;
        const card = who === seat ? line[view.recap.tricks.length - before] : cards[Math.floor(rng() * cards.length)];
        at = applyAction(at, { type: 'play_card', seat: who, card });
      }
      assert(at);
    }
  }
  return playouts;
}

export function fuzz(games: number, prefix = 'fuzz', maxActions = 3000): {
  played: number; actions: number; failures: FuzzFailure[];
  /** how often each action type was played, so a run shows it reached every decision */
  kinds: Record<string, number>;
  claims: { positions: number; playouts: number };
} {
  const failures: FuzzFailure[] = [];
  const kinds: Record<string, number> = {};
  const claims = { positions: 0, playouts: 0 };
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
        const action = state.phase === 'hand_over' ? { type: 'next_hand', seat } as Action : fuzzAction(state, seat);
        if (state.phase === 'playing' && viewFor(state, seat).legal.canClaim) {
          claims.positions++;
          claims.playouts += verifyClaim(state, `${seed}:${state.rev}:claim`);
        }
        const kind = action.type === 'shoot' && state.phase === 'deciding_shoot' ? 'shoot_after_pass' : action.type;
        state = applyAction(state, action);
        actions.push(action);
        kinds[kind] = (kinds[kind] ?? 0) + 1;
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
  return { played: games, actions: total, failures, kinds, claims };
}
