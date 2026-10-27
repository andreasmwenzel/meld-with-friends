// Dev tooling: build a GameState for any situation by stacking the deal and replaying real actions.
// Every state produced here was reached through applyAction, so it is one the engine can really be in.
// Not exported from the engine index; only dev pages, scripts and tests import it.
import { chooseAction } from './ai';
import { buildDeck, seededShuffle } from './deck';
import { applyAction, applyLegacyAction, newGame, viewFor } from './game';
import { DEFAULT_RULES } from './types';
import type {
  Action, CardId, GameState, HandRecord, Phase, Rank, RulesConfig, SeatIndex, Suit, Team, TrickPlay,
} from './types';

export const SEATS: readonly SeatIndex[] = [0, 1, 2, 3];
const teamOf = (seat: SeatIndex): Team => seat % 2 === 0 ? 'red' : 'blue';

/** Phases a scenario can stop in. "dealing" never persists, so it is not a target. */
export type ScenarioTarget = Exclude<Phase, 'dealing'>;

export interface ScenarioSpec {
  seed?: string;
  rules?: Partial<RulesConfig>;
  dealer?: SeatIndex;
  /** start on this hand number; earlier hands are synthesised into history so the scorepad adds up */
  handNumber?: number;
  /** running score before this hand */
  score?: Partial<Record<Team, number>>;
  /**
   * Dealt hands, as card ids ("AS0") or short names ("AS", "10S", "A♠"; the free copy is used).
   * Seats left out, or given fewer than 12, are filled from the rest of the deck.
   */
  hands?: Partial<Record<SeatIndex, string[]>>;
  /** where to stop (default "bidding") */
  to?: ScenarioTarget;
  /**
   * The auction, one entry per turn from the dealer's left: a number bids, null passes. "shoot" is legacy-only.
   * When omitted, `bidder` takes the contract at `bid` and everyone else passes.
   */
  bids?: (number | null | 'shoot')[];
  bidder?: SeatIndex;
  bid?: number;
  /** the bidder shoots after the pass */
  shoot?: boolean;
  /** the bidder shoots after the pass (default: plays it out once past deciding_shoot) */
  shootAfterPass?: boolean;
  trump?: Suit;
  /** cards the bidder's partner passes over, and the bidder passes back; the bot picks when omitted */
  passToBidder?: string[];
  passBack?: string[];
  /** per-seat meld: "full" lays the whole hand down (default), "none" melds nothing, or exact cards */
  meld?: Partial<Record<SeatIndex, 'full' | 'none' | string[]>>;
  /** stopping in melding: seats that have already confirmed */
  confirmed?: SeatIndex[];
  /** stopping in playing: complete tricks to play first (default 0) */
  tricks?: number;
  /** then cards into the current trick (default: until `turn` is on play, or 0) */
  plays?: number;
  /** stopping in playing: keep playing until this seat is on turn */
  turn?: SeatIndex;
  /** cards to play, in order, before the bot decides; each must be legal when its turn comes */
  play?: string[];
}

export interface Scenario {
  /** the state right after the stacked deal; replaying `actions` over it gives `state` */
  base: GameState;
  actions: Action[];
  state: GameState;
  /** human-readable notes when the spec could not be followed exactly */
  notes: string[];
}

const SHORT = /^(10|[ATKQJ9])([SHDC♠♥♦♣])([01])?$/i;
const SUIT_OF: Record<string, Suit> = { S: 'S', H: 'H', D: 'D', C: 'C', '♠': 'S', '♥': 'H', '♦': 'D', '♣': 'C' };

/** Resolve short card names against the cards still free; throws on unknown or exhausted cards. */
export function resolveCards(names: readonly string[], free: Set<CardId>): CardId[] {
  return names.map(name => {
    const match = SHORT.exec(name.trim().toUpperCase());
    if (!match) throw new Error(`Unknown card "${name}"`);
    const rank = (match[1] === '10' ? 'T' : match[1]) as Rank;
    const suit = SUIT_OF[match[2]];
    const options = match[3] !== undefined ? [`${rank}${suit}${match[3]}`] : [`${rank}${suit}0`, `${rank}${suit}1`];
    const card = options.find(id => free.has(id as CardId)) as CardId | undefined;
    if (!card) throw new Error(`No ${name} left to deal`);
    free.delete(card);
    return card;
  });
}

/** Replace the deal of a fresh hand in the bidding phase. Hands are completed from the leftover deck. */
export function stackDeal(state: GameState, hands: Partial<Record<SeatIndex, string[]>>, seed = state.seed): GameState {
  if (state.phase !== 'bidding' || state.bids.length) throw new Error('Hands can only be stacked before the first bid');
  const free = new Set(buildDeck());
  const dealt = { 0: [], 1: [], 2: [], 3: [] } as Record<SeatIndex, CardId[]>;
  for (const seat of SEATS) {
    const names = hands[seat] ?? [];
    if (names.length > 12) throw new Error(`Seat ${seat} was given ${names.length} cards; a hand holds 12`);
    dealt[seat] = resolveCards(names, free);
  }
  const rest = seededShuffle([...free].sort(), `${seed}:stack`);
  for (const seat of SEATS) while (dealt[seat].length < 12) dealt[seat].push(rest.pop()!);
  const next = structuredClone(state) as GameState & { handsDealt?: Record<SeatIndex, CardId[]> };
  for (const seat of SEATS) next.players[seat].hand = [...dealt[seat]];
  next.handsDealt = structuredClone(dealt);
  return next;
}

/** Plausible earlier hands whose deltas add up to `score`, so totals and the scorepad agree. */
export function synthHistory(score: Record<Team, number>, hands: number, firstDealer: SeatIndex, rules: RulesConfig = DEFAULT_RULES): HandRecord[] {
  const records: HandRecord[] = [];
  const unit = rules.scoring === 'classic' ? 10 : 1;
  const split = (total: number, i: number) => {
    const base = Math.trunc(total / hands / unit) * unit;
    return i === hands - 1 ? total - base * (hands - 1) : base;
  };
  for (let i = 0; i < hands; i++) {
    const dealer = ((firstDealer + i) % 4) as SeatIndex;
    const bidder = ((dealer + 1) % 4) as SeatIndex;
    const delta = { red: split(score.red, i), blue: split(score.blue, i) };
    const breakdown = (team: Team) => {
      const d = delta[team];
      const meld = d > 0 ? Math.round(d * 0.4 / unit) * unit : 0;
      return { meldDeclared: meld, meldSaved: meld, counters: d > 0 ? d - meld : 0, lastTrick: 0, setPenalty: d < 0 ? -d : 0, shoot: 0 };
    };
    const b = { red: breakdown('red'), blue: breakdown('blue') };
    const bidTeam = teamOf(bidder);
    records.push({
      handNumber: i + 1, dealer, bidder, bid: delta[bidTeam] < 0 ? -delta[bidTeam] : rules.minBid, trump: (['S', 'H', 'D', 'C'] as const)[i % 4],
      meld: { red: b.red.meldDeclared, blue: b.blue.meldDeclared },
      tricks: { red: b.red.counters, blue: b.blue.counters },
      delta, breakdown: b, wentSet: delta[bidTeam] < 0,
    });
  }
  return records;
}

/** Fresh hand at the requested hand number, dealer and score, before any stacking. */
export function scenarioStart(spec: ScenarioSpec): GameState {
  const handNumber = Math.max(1, Math.floor(spec.handNumber ?? 1));
  const dealer = spec.dealer ?? (((handNumber - 1) % 4) as SeatIndex);
  let state = newGame(spec.seed ?? 'lab', spec.rules ?? {}, dealer);
  const score = { red: spec.score?.red ?? 0, blue: spec.score?.blue ?? 0 };
  if (handNumber > 1 || score.red || score.blue) {
    state = structuredClone(state);
    // Deal for the requested hand number so seeds give different hands per hand, as in a real game.
    state.handNumber = handNumber;
    state = stackDeal(state, {}, `${state.seed}:${handNumber}`);
    state.score = score;
    const earlier = handNumber - 1;
    state.history = earlier ? synthHistory(score, earlier, ((dealer - earlier % 4 + 4) % 4) as SeatIndex, state.rules) : [];
    state.log = [`Hand ${handNumber}: ${['South', 'West', 'North', 'East'][dealer]} deals`];
  }
  return spec.hands ? stackDeal(state, spec.hands, spec.seed ?? 'lab') : state;
}

const PHASE_ORDER: ScenarioTarget[] = ['bidding', 'declaring_trump', 'passing_to_bidder', 'passing_back', 'deciding_shoot', 'melding', 'playing', 'hand_over', 'game_over'];

/** Fast deterministic bot for filling in whatever the spec leaves open. */
export function botAction(state: GameState, seat: SeatIndex): Action {
  return chooseAction(viewFor(state, seat), { seed: `${state.seed}:${state.rev}`, config: { samples: 6, budgetMs: 4 } });
}

/** Seats that can act right now, in the order a table would see them. */
export function actors(state: GameState): SeatIndex[] {
  if (state.phase === 'melding') return SEATS.filter(seat => !state.players[seat].meldConfirmed);
  if (state.phase === 'hand_over') return [];
  return state.turn === null ? [] : [state.turn];
}

export function buildScenario(spec: ScenarioSpec): Scenario {
  const to = spec.to ?? 'bidding';
  const base = scenarioStart(spec);
  let state = base;
  const actions: Action[] = [];
  const notes: string[] = [];
  const apply = (action: Action) => { state = applyAction(state, action); actions.push(action); };
  // Scripted auction: explicit bids, or a named contract with everyone else passing.
  const auction = spec.bids ? [...spec.bids] : null;
  const reached = () => {
    if (state.phase === 'game_over') return true;
    const at = PHASE_ORDER.indexOf(state.phase as ScenarioTarget);
    if (at < PHASE_ORDER.indexOf(to)) return false;
    if (at > PHASE_ORDER.indexOf(to)) return true;
    if (to === 'bidding') return !auction?.length;
    if (to === 'melding') return (spec.confirmed ?? []).every(seat => state.players[seat].meldConfirmed);
    if (to !== 'playing') return true;
    const done = state.tricksTaken.red.length + state.tricksTaken.blue.length;
    if (done < (spec.tricks ?? 0)) return false;
    const inTrick = state.currentTrick?.plays.length ?? 0;
    if (spec.plays !== undefined) return inTrick >= spec.plays;
    return spec.turn === undefined || state.turn === spec.turn;
  };

  const contractBid = spec.bid ?? state.rules.minBid;
  // The dealer cannot open against three passes, so someone opens for them first.
  const opener = spec.bidder !== undefined && spec.bidder === state.dealer && contractBid > state.rules.minBid
    ? (((state.dealer + 1) % 4) as SeatIndex) : null;
  const playQueue = spec.play ? [...spec.play] : [];

  for (let guard = 0; guard < 400 && !reached(); guard++) {
    const handAtStart = state.handNumber;
    if (state.phase === 'hand_over') { notes.push('Hand ended before the target was reached'); break; }
    if (state.phase === 'melding') {
      // Seats asked to have confirmed go first; past melding, everyone lays down and confirms.
      const seat = to === 'melding' ? (spec.confirmed ?? []).find(s => !state.players[s].meldConfirmed)! : actors(state)[0];
      const choice = spec.meld?.[seat] ?? 'full';
      if (choice !== 'none') {
        const hand = state.players[seat].hand;
        apply({ type: 'declare_meld', seat, cards: choice === 'full' ? [...hand] : resolveOwned(choice, hand) });
      }
      apply({ type: 'confirm_meld', seat });
      continue;
    }
    const seat = state.turn;
    if (seat === null) break;
    const legal = viewFor(state, seat).legal;
    if (state.phase === 'bidding') {
      if (auction) {
        const next = auction.length ? auction.shift()! : null;
        if (next === 'shoot') { const action: Action = { type: 'shoot', seat }; state = applyLegacyAction(state, action); actions.push(action); }
        else if (next === null || !legal.canBid) apply({ type: 'pass_bid', seat });
        else apply({ type: 'bid', seat, amount: next });
      } else if (spec.bidder === undefined) apply(botAction(state, seat));
      else if (seat === spec.bidder) {
        if (legal.canBid) apply({ type: 'bid', seat, amount: Math.max(contractBid, legal.minBid ?? 0) });
        else apply({ type: 'pass_bid', seat }); // stuck dealer takes the minimum
      } else if (seat === opener && !state.bids.some(b => b.seat === seat)) apply({ type: 'bid', seat, amount: state.rules.minBid });
      else apply({ type: 'pass_bid', seat });
      if (state.handNumber !== handAtStart) { notes.push('Everyone passed and the hand was redealt'); break; }
      continue;
    }
    if (state.phase === 'declaring_trump') {
      apply(spec.trump ? { type: 'declare_trump', seat, suit: spec.trump } : botAction(state, seat));
      continue;
    }
    if (state.phase === 'passing_to_bidder' || state.phase === 'passing_back') {
      const names = state.phase === 'passing_to_bidder' ? spec.passToBidder : spec.passBack;
      apply(names ? { type: 'pass_cards', seat, cards: resolveOwned(names, state.players[seat].hand) } : botAction(state, seat));
      continue;
    }
    if (state.phase === 'deciding_shoot') {
      apply({ type: spec.shootAfterPass || spec.shoot ? 'shoot' : 'decline_shoot', seat });
      continue;
    }
    if (state.phase === 'playing') {
      if (playQueue.length) {
        const card = resolveOwned([playQueue[0]], state.players[seat].hand)[0];
        if (!legal.playableCards.includes(card)) throw new Error(`${playQueue[0]} is not a legal play for seat ${seat} now`);
        playQueue.shift();
        apply({ type: 'play_card', seat, card });
      } else {
        // A position requested mid-play must stay there even if a bot could end it by claiming.
        const view = viewFor(state, seat);
        if (to === 'playing') view.legal.canClaim = false;
        apply(chooseAction(view, { seed: `${state.seed}:${state.rev}`, config: { samples: 6, budgetMs: 4 } }));
      }
      continue;
    }
    break;
  }
  if (!reached() && !notes.length) notes.push(`Stopped in ${state.phase}, short of ${to}`);
  if (to === 'game_over' && state.phase !== 'game_over') notes.push('Nobody reached the target; raise a score closer to it');
  return { base, actions, state, notes };
}

/** Map short card names onto the exact copies in a hand. */
export function resolveOwned(names: readonly string[], hand: readonly CardId[]): CardId[] {
  return resolveCards(names, new Set(hand));
}

/** Everything that should always hold. Returns problems in plain words; empty means healthy. */
export function checkState(input: GameState): string[] {
  const state = input as GameState & { playedCards?: TrickPlay[]; handsAtPlay?: Record<SeatIndex, CardId[]> };
  const problems: string[] = [];
  const all = [
    ...state.players.flatMap(p => [...p.hand, ...p.passBuffer]),
    ...state.tricksTaken.red.flat(), ...state.tricksTaken.blue.flat(),
    ...(state.currentTrick?.plays.map(p => p.card) ?? []),
  ];
  const deck = buildDeck();
  const counts = new Map<string, number>();
  for (const card of all) counts.set(card, (counts.get(card) ?? 0) + 1);
  const missing = deck.filter(card => !counts.has(card));
  const dupes = [...counts].filter(([, n]) => n > 1).map(([c]) => c);
  const strangers = [...counts.keys()].filter(c => !deck.includes(c as CardId));
  if (missing.length) problems.push(`Missing cards: ${missing.join(' ')}`);
  if (dupes.length) problems.push(`Duplicated cards: ${dupes.join(' ')}`);
  if (strangers.length) problems.push(`Unknown cards: ${strangers.join(' ')}`);
  const tricks = state.tricksTaken.red.length + state.tricksTaken.blue.length;
  const inTrick = state.currentTrick?.plays.length ?? 0;
  if (['playing', 'hand_over', 'game_over'].includes(state.phase) || state.phase === 'melding') {
    const sizes = state.players.map(p => p.hand.length + (state.currentTrick?.plays.some(x => x.seat === p.seat) ? 1 : 0));
    if (state.phase === 'playing' && sizes.some((n, seat) => n !== (seat === state.sittingOut ? 12 : 12 - tricks))) problems.push(`Hand sizes ${state.players.map(p => p.hand.length).join('/')} do not fit ${tricks} tricks and ${inTrick} cards in play`);
  }
  if (state.phase === 'bidding' && state.players.some(p => p.hand.length !== 12)) problems.push('Every hand should hold 12 cards while bidding');
  const onTurn = state.turn;
  if (['bidding', 'declaring_trump', 'passing_to_bidder', 'passing_back', 'deciding_shoot', 'playing'].includes(state.phase) && onTurn === null) problems.push(`Nobody is on turn in ${state.phase}`);
  if (state.phase === 'playing' && state.currentTrick && onTurn !== null) {
    let expected = state.currentTrick.leader;
    for (let i = 0; i < inTrick; i++) {
      expected = ((expected + 1) % 4) as SeatIndex;
      if (expected === state.sittingOut) expected = ((expected + 1) % 4) as SeatIndex;
    }
    if (expected !== onTurn) problems.push(`Seat ${onTurn} is on turn but seat ${expected} should play next`);
  }
  if (['declaring_trump', 'passing_to_bidder', 'passing_back', 'deciding_shoot', 'melding', 'playing'].includes(state.phase) && state.bidder === null) problems.push('No bidder after the auction');
  if (state.phase === 'deciding_shoot' && (state.turn !== state.bidder || state.highBid?.shoot || state.rules.shoot === 'off')) problems.push('Only a bidder who has not shot decides on a shoot, with shooting on');
  if (['passing_to_bidder', 'passing_back', 'deciding_shoot', 'melding', 'playing'].includes(state.phase) && !state.trump) problems.push('No trump after it was declared');
  for (const team of ['red', 'blue'] as const) {
    const sum = state.history.reduce((total, h) => total + h.delta[team], 0);
    if (sum !== state.score[team]) problems.push(`${team} score ${state.score[team]} differs from its history total ${sum}`);
  }
  const played = state.playedCards ?? [];
  for (const p of state.players) {
    const owned = new Set([...p.hand, ...played.filter(c => c.seat === p.seat).map(c => c.card)]);
    const stray = p.meld.flatMap(m => m.cards).filter(c => !owned.has(c));
    if (stray.length) problems.push(`Seat ${p.seat} melds cards it never held: ${stray.join(' ')}`);
  }
  if (state.sittingOut != null) {
    if (!state.highBid?.shoot || state.bidder === null || state.sittingOut !== (state.bidder + 2) % 4) problems.push('Invalid sit-out seat');
    if (state.turn === state.sittingOut || played.some(p => p.seat === state.sittingOut)) problems.push('The sitting-out partner played');
    if (state.players[state.sittingOut].hand.length !== 12) problems.push('The set-aside hand must stay intact');
    if (state.players.some(p => p.meld.length || p.meldPoints)) problems.push('Meld on a solo shoot');
    if ([...state.tricksTaken.red, ...state.tricksTaken.blue].some(t => t.length !== 3)) problems.push('A solo shoot trick must hold three cards');
    if (inTrick >= 3) problems.push('Unresolved three-card trick');
  }
  if (state.phase === 'game_over' && !state.winner) problems.push('Game over without a winner');
  if (state.winner && state.phase !== 'game_over') problems.push('A winner is set but the game is not over');
  return problems;
}
