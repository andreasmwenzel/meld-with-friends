import { buildDeck, cardLabel, seededShuffle, SUITS } from './deck';
import { computeMeld, qualifiesForMisdeal } from './meld';
import { legalPlays, playConstraint, trickWinner } from './rules';
import { IllegalAction } from './types';
import { legacyShootRules, resolveRules } from './scoring';
import { claimLine } from './claim';
import type {
  Action, CardId, GameState, HandRecap, HandRecord, HandScoreBreakdown, LegalActions, PlayerState, PlayerView,
  Rank, RulesConfig, SeatIndex, Team, Trick,
} from './types';

export const SEAT_NAMES = ['South', 'West', 'North', 'East'] as const;
const SEATS: readonly SeatIndex[] = [0, 1, 2, 3];
const CLASSIC_POINTS: Record<Rank, number> = { A: 11, T: 10, K: 4, Q: 3, J: 2, '9': 0 };
// Private fields persist in JSON but are only exposed through viewFor.
type Hands = Record<SeatIndex, CardId[]>;
interface EngineState extends GameState {
  claim?: PlayerView['claim'];
  completedTricks?: HandRecap["tricks"];
  passedOut?: Hands;
  passedIn?: Hands;
  lastTrick?: Trick | null;
  playedCards?: import("./types").TrickPlay[];
  handsDealt?: Hands;
  handsAtPlay?: Hands;
  /** the last deal thrown in for nines; cleared by the next ordinary deal */
  misdeal?: { seat: SeatIndex; hand: CardId[] } | null;
}
const emptyHands = (): Hands => ({ 0: [], 1: [], 2: [], 3: [] });
const snapshotHands = (state: GameState): Hands => ({
  0: [...state.players[0].hand], 1: [...state.players[1].hand],
  2: [...state.players[2].hand], 3: [...state.players[3].hand],
});
const nextSeat = (seat: SeatIndex): SeatIndex => ((seat + 1) % 4) as SeatIndex;
const partner = (seat: SeatIndex): SeatIndex => ((seat + 2) % 4) as SeatIndex;
const teamOf = (seat: SeatIndex): Team => seat % 2 === 0 ? 'red' : 'blue';
const otherTeam = (team: Team): Team => team === 'red' ? 'blue' : 'red';
const clone = <T>(value: T): T => structuredClone(value);
function requireAction(condition: unknown, message: string): asserts condition {
  if (!condition) throw new IllegalAction(message);
}
function log(state: GameState, message: string): void {
  state.log = [...state.log, message].slice(-50);
}
export function validateRules(rules: RulesConfig): void {
  for (const key of ['target', 'minBid', 'bidStep'] as const) {
    requireAction(Number.isSafeInteger(rules[key]) && rules[key] > 0, `${key} must be a positive integer`);
  }
  for (const key of ['counterValue', 'lastTrickBonus', 'passCount'] as const) {
    requireAction(Number.isSafeInteger(rules[key]) && rules[key] >= 0, `${key} must be a nonnegative integer`);
  }
  requireAction(rules.scoring === 'modern' || rules.scoring === 'classic', 'Invalid scoring');
  requireAction(rules.scoring !== 'modern' || rules.counting !== 'classic', 'Old-style counting requires classic scoring');
  requireAction(rules.pace === 'live' || rules.pace === 'leisurely', 'Invalid pace');
  requireAction(rules.passCount <= 12, 'passCount cannot exceed 12');
  requireAction(rules.setPenaltyIsBid === true, 'Only bid-sized set penalties are supported');
  requireAction(rules.counting === 'tens' || rules.counting === 'classic', 'counting must be tens or classic');
  requireAction(['off', 'on'].includes(rules.shoot), 'Invalid shoot mode');
  requireAction(typeof rules.dealerStuck === 'boolean' && typeof rules.mustTakeTrickToSaveMeld === 'boolean' && typeof rules.revealHands === 'boolean'
    && typeof rules.ninesMisdeal === 'boolean', 'Rule flags must be booleans');
}
function emptyPlayers(): GameState['players'] {
  const player = (seat: SeatIndex): PlayerState => ({
    seat, hand: [], meld: [], meldPoints: 0, meldConfirmed: false, passBuffer: [],
  });
  return [player(0), player(1), player(2), player(3)];
}
function deal(state: EngineState): void {
  const deck = seededShuffle(buildDeck(), `${state.seed}:${state.handNumber}`);
  state.players = emptyPlayers();
  for (let i = 0; i < deck.length; i++) {
    const seat = ((state.dealer + 1 + i) % 4) as SeatIndex;
    state.players[seat].hand.push(deck[i]);
  }
  state.handsDealt = snapshotHands(state);
  state.handsAtPlay = emptyHands();
  state.phase = 'bidding';
  state.turn = nextSeat(state.dealer);
  state.bids = [];
  state.highBid = null;
  state.bidder = null;
  state.trump = null;
  state.currentTrick = null;
  state.lastTrick = null;
  state.playedCards = [];
  state.completedTricks = [];
  state.passedOut = emptyHands();
  state.passedIn = emptyHands();
  state.tricksTaken = { red: [], blue: [] };
  state.misdeal = null;
  state.claim = null;
  state.sittingOut = null;
  log(state, `Hand ${state.handNumber}: ${SEAT_NAMES[state.dealer]} deals`);
}

export function newGame(seed: string, rules: Partial<RulesConfig> = {}, dealer: SeatIndex = 0): GameState {
  requireAction(SEATS.includes(dealer), 'Invalid dealer seat');
  const config = resolveRules(rules);
  validateRules(config);
  const state: EngineState = {
    version: 1, rules: config, phase: 'dealing', handNumber: 1, dealer, turn: null,
    players: emptyPlayers(), bids: [], highBid: null,
    bidder: null, trump: null, currentTrick: null, tricksTaken: { red: [], blue: [] },
    score: { red: 0, blue: 0 }, history: [], winner: null, seed, rev: 0, log: [],
  };
  deal(state);
  return state;
}

function openingBid(state: GameState): number {
  const floor = Math.max(state.rules.minBid, (state.highBid?.amount ?? 0) + 1);
  return Math.ceil(floor / state.rules.bidStep) * state.rules.bidStep;
}

export function legalActionsFor(state: GameState, seat: SeatIndex): LegalActions {
  requireAction(SEATS.includes(seat), 'Invalid seat');
  state = { ...state, rules: resolveRules(state.rules, true) };
  const onTurn = state.turn === seat;
  const bidding = state.phase === 'bidding' && onTurn && !state.bids.some(b => b.seat === seat && b.amount === null);
  const melding = state.phase === 'melding' && !state.players[seat].meldConfirmed;
  const shotBid = state.bids.some(bid => bid.shoot);
  // With no competing bidder, the dealer takes the minimum (or redeals).
  const allOthersPassed = seat === state.dealer && !state.highBid
    && SEATS.every(other => other === seat || state.bids.some(b => b.seat === other && b.amount === null));
  const canBid = bidding && !shotBid && !allOthersPassed;
  const deciding = state.phase === 'deciding_shoot' && onTurn && seat === state.bidder;
  return {
    canBid, minBid: canBid ? openingBid(state) : null,
    canShoot: deciding && state.rules.shoot !== 'off',
    canDeclineShoot: deciding,
    canMisdeal: bidding && state.rules.ninesMisdeal && !state.bids.some(b => b.seat === seat)
      && qualifiesForMisdeal(state.players[seat].hand),
    canPassBid: bidding, canDeclareTrump: state.phase === 'declaring_trump' && onTurn,
    mustPassCount: onTurn && (state.phase === 'passing_to_bidder' || state.phase === 'passing_back') ? state.rules.passCount : null,
    canDeclareMeld: melding, canConfirmMeld: melding,
    // Claim proofs currently assume four active seats. Solo shoots must be played out.
    canClaim: state.sittingOut == null && claimLine({ phase: state.phase, seat, turn: state.turn, hand: state.players[seat].hand,
      playedCards: (state as EngineState).playedCards ?? [], currentTrick: state.currentTrick, trump: state.trump }) !== null,
    playableCards: state.phase === 'playing' && onTurn && seat !== state.sittingOut && state.currentTrick && state.trump
      ? legalPlays(state.players[seat].hand, state.currentTrick, state.trump) : [],
    playConstraint: state.phase === 'playing' && onTurn && seat !== state.sittingOut && state.currentTrick && state.trump
      ? playConstraint(state.players[seat].hand, state.currentTrick, state.trump) : null,
    canAdvanceHand: state.phase === 'hand_over',
  };
}

function selectedCards(player: PlayerState, cards: CardId[]): void {
  requireAction(Array.isArray(cards), 'Cards must be an array');
  requireAction(new Set(cards).size === cards.length, 'A card cannot be selected twice');
  requireAction(cards.every(card => player.hand.includes(card)), 'Selected cards must be in your hand');
}
function awardBid(state: GameState): void {
  requireAction(state.highBid?.amount !== null && state.highBid !== null, 'No winning bid');
  state.bidder = state.highBid.seat;
  state.turn = state.bidder;
  state.phase = 'declaring_trump';
  log(state, `${SEAT_NAMES[state.bidder]} wins the bid at ${state.highBid.amount}`);
}
function finishBiddingAction(state: EngineState): void {
  const passed = new Set(state.bids.filter(b => b.amount === null).map(b => b.seat));
  if (passed.size === 4) {
    if (state.rules.dealerStuck) {
      state.highBid = { seat: state.dealer, amount: state.rules.minBid };
      log(state, `${SEAT_NAMES[state.dealer]} is stuck at ${state.rules.minBid}`);
      awardBid(state);
    } else {
      log(state, 'Everyone passes; redealing');
      state.dealer = nextSeat(state.dealer);
      state.handNumber++;
      deal(state);
    }
  } else if (passed.size === 3 && state.highBid) {
    awardBid(state);
  } else {
    requireAction(state.turn !== null, 'Bidding requires a turn');
    do { state.turn = nextSeat(state.turn); } while (passed.has(state.turn));
  }
}
/**
 * Once the bidder holds the passed cards (or trump is named, with passing off), a bidder who has not
 * shot decides whether to shoot before anyone lays down meld. Otherwise meld begins.
 */
function afterPass(state: GameState): void {
  requireAction(state.bidder !== null, 'No bidder');
  if (state.rules.shoot !== 'off' && !state.highBid?.shoot) {
    state.phase = 'deciding_shoot';
    state.turn = state.bidder;
  } else startMeld(state);
}
function startMeld(state: GameState): void {
  state.phase = 'melding';
  state.turn = null;
}
function countCounters(cards: CardId[], rules: RulesConfig): number {
  return cards.reduce((total, card) => {
    const rank = card[0] as Rank;
    return total + (rules.counting === 'classic' ? CLASSIC_POINTS[rank]
      : ['A', 'T', 'K'].includes(rank) ? rules.counterValue : 0);
  }, 0);
}
function finishHand(state: GameState, lastWinner: SeatIndex, shotMade?: boolean): void {
  requireAction(state.bidder !== null && state.highBid?.amount != null && state.trump !== null, 'Hand is missing its contract');
  const solo = state.sittingOut != null;
  const meld = { red: 0, blue: 0 };
  for (const player of solo ? [] : state.players) meld[teamOf(player.seat)] += player.meldPoints;
  const counters = { red: 0, blue: 0 };
  for (const team of ['red', 'blue'] as const) {
    counters[team] = solo ? 0 : countCounters(state.tricksTaken[team].flat(), state.rules);
  }
  const lastTrick = { red: 0, blue: 0 };
  if (!solo && state.players.every(player => player.hand.length === 0)) {
    lastTrick[teamOf(lastWinner)] = state.rules.lastTrickBonus;
  }
  const tricks = { red: counters.red + lastTrick.red, blue: counters.blue + lastTrick.blue };
  const breakdown: Record<Team, HandScoreBreakdown> = {
    red: { meldDeclared: meld.red, meldSaved: 0, counters: 0, lastTrick: 0, setPenalty: 0, shoot: 0 },
    blue: { meldDeclared: meld.blue, meldSaved: 0, counters: 0, lastTrick: 0, setPenalty: 0, shoot: 0 },
  };
  const bidding = teamOf(state.bidder);
  const defending = otherTeam(bidding);
  // A side with no trick cannot save meld, including the bidding side.
  const savedMeld = (team: Team) => !state.rules.mustTakeTrickToSaveMeld || state.tricksTaken[team].length > 0 ? meld[team] : 0;
  const scoreNormally = (team: Team) => Object.assign(breakdown[team], {
    meldSaved: savedMeld(team), counters: counters[team], lastTrick: lastTrick[team],
  });
  const bid = state.highBid.amount;
  if (state.highBid.shoot) {
    requireAction(shotMade !== undefined, 'Shoot outcome is missing');
    const delta = { red: 0, blue: 0 };
    if (solo) {
      delta[bidding] = shotMade ? state.rules.target : 0;
      breakdown[bidding].shoot = delta[bidding];
      if (!shotMade) state.winner = defending;
    } else if (state.legacyShootRules?.mode !== 'points') {
      const winner = shotMade ? bidding : defending;
      delta[winner] = Math.max(state.score[winner], state.rules.target) - state.score[winner];
      breakdown[winner].shoot = delta[winner];
      state.winner = winner;
    } else {
      delta[bidding] = shotMade ? (state.legacyShootRules?.points ?? state.rules.target) : -(state.legacyShootRules?.points ?? state.rules.target);
      delta[defending] = savedMeld(defending) + tricks[defending];
      breakdown[bidding].shoot = delta[bidding];
      scoreNormally(defending);
    }
    state.score.red += delta.red;
    state.score.blue += delta.blue;
    state.history.push({ handNumber: state.handNumber, dealer: state.dealer, bidder: state.bidder,
      bid, trump: state.trump, meld, tricks, delta, breakdown, wentSet: !shotMade, shotMade,
      ...(state.sittingOut != null ? { sittingOut: state.sittingOut } : {}) });
    if (!state.winner && (state.score[bidding] >= state.rules.target || state.score[defending] >= state.rules.target)) {
      state.winner = state.score[bidding] >= state.rules.target ? bidding : defending;
    }
    state.turn = null;
    state.phase = state.winner ? 'game_over' : 'hand_over';
    log(state, `${SEAT_NAMES[state.bidder]} ${shotMade ? 'makes' : 'misses'} the shoot${solo && !shotMade ? '; shooting side loses the game' : '; hand over'}`);
    if (state.winner) log(state, `${state.winner === 'red' ? 'Red' : 'Blue'} wins the game`);
    return;
  }
  const wentSet = savedMeld(bidding) + tricks[bidding] < bid;
  const delta = { red: 0, blue: 0 };
  delta[bidding] = wentSet ? -bid : savedMeld(bidding) + tricks[bidding];
  delta[defending] = savedMeld(defending) + tricks[defending];
  if (wentSet) breakdown[bidding].setPenalty = bid;
  else scoreNormally(bidding);
  scoreNormally(defending);
  state.score.red += delta.red;
  state.score.blue += delta.blue;
  state.history.push({ handNumber: state.handNumber, dealer: state.dealer, bidder: state.bidder,
    bid, trump: state.trump, meld, tricks, delta, breakdown, wentSet });
  state.turn = null;
  state.phase = 'hand_over';
  log(state, `${bidding === 'red' ? 'Red' : 'Blue'} ${wentSet ? `goes set for ${bid}` : `makes ${delta[bidding]}`}; hand over`);
  if (state.score[bidding] >= state.rules.target || state.score[defending] >= state.rules.target) {
    state.winner = state.score[bidding] >= state.rules.target ? bidding : defending;
    state.phase = 'game_over';
    log(state, `${state.winner === 'red' ? 'Red' : 'Blue'} wins the game`);
  }
}

/** Mutates a cloned state through the same legal trick and scoring path for plays and claims. */
function playCard(state: EngineState, seat: SeatIndex, card: CardId, claiming = false): void {
  requireAction(state.currentTrick !== null && state.trump !== null, 'No active trick');
  const player = state.players[seat];
  const name = SEAT_NAMES[seat];
  player.hand = player.hand.filter(held => held !== card);
  state.currentTrick.plays.push({ seat, card });
  (state.playedCards ??= []).push({ seat, card });
  if (!claiming) log(state, `${name} plays ${cardLabel(card)}`);
  if (state.currentTrick.plays.length === (state.sittingOut != null ? 3 : 4)) {
    const winner = trickWinner(state.currentTrick, state.trump);
    state.currentTrick.winner = winner;
    state.lastTrick = clone(state.currentTrick);
    const completed = state.completedTricks ??= [];
    completed.push({ index: state.tricksTaken.red.length + state.tricksTaken.blue.length + 1,
      leader: state.currentTrick.leader, plays: clone(state.currentTrick.plays), winner,
      counters: state.sittingOut != null ? 0 : countCounters(state.currentTrick.plays.map(play => play.card), state.rules) });
    state.tricksTaken[teamOf(winner)].push(state.currentTrick.plays.map(play => play.card));
    if (!claiming) log(state, `${SEAT_NAMES[winner]} takes the trick`);
    state.currentTrick = { leader: winner, plays: [], winner: null };
    state.turn = winner;
    const shootLost = state.highBid?.shoot && state.bidder !== null && (state.sittingOut != null ? winner !== state.bidder : teamOf(winner) !== teamOf(state.bidder));
    if (shootLost || (state.sittingOut != null && state.bidder !== null ? state.players[state.bidder].hand.length === 0 : state.players.every(p => p.hand.length === 0))) {
      state.currentTrick = null;
      finishHand(state, winner, state.highBid?.shoot ? !shootLost : undefined);
    }
  } else {
    state.turn = nextSeat(seat);
    if (state.turn === state.sittingOut) state.turn = nextSeat(state.turn);
  }
}

export function applyAction(previous: GameState, action: Action): GameState {
  return apply(previous, action, false);
}
/** Trusted action-log replay only. Live server actions always use applyAction. */
export function applyLegacyAction(previous: GameState, action: Action): GameState {
  return apply(previous, action, true);
}
function apply(previous: GameState, action: Action, legacyShoot: boolean): GameState {
  requireAction(SEATS.includes(action.seat), 'Invalid seat');
  const legal = legalActionsFor(previous, action.seat);
  const state: EngineState = clone(previous);
  if ((legacyShoot || state.highBid?.shoot && state.sittingOut == null) && !state.legacyShootRules) {
    state.legacyShootRules = legacyShootRules(state.rules);
  }
  state.rules = resolveRules(state.rules, true);
  const player = state.players[action.seat];
  const name = SEAT_NAMES[action.seat];
  switch (action.type) {
    case 'shoot': {
      const legacyAuction = legacyShoot && state.phase === 'bidding' && legal.canPassBid
        && state.rules.shoot !== 'off' && !state.bids.some(bid => bid.shoot);
      requireAction(legal.canShoot || legacyAuction, 'You cannot shoot now');
      const amount = legacyShoot && state.legacyShootRules?.mode === 'points'
        ? state.legacyShootRules.points : state.rules.target;
      state.highBid = { seat: action.seat, amount, shoot: true };
      log(state, `${name} shoots the moon`);
      if (legacyAuction) {
        state.bids.push({ ...state.highBid });
        finishBiddingAction(state);
      } else if (legacyShoot) startMeld(state);
      else {
        state.sittingOut = partner(action.seat);
        // Keep the set-aside hand for conservation and the optional hand-end reveal only.
        state.handsAtPlay = snapshotHands(state);
        for (const p of state.players) { p.meld = []; p.meldPoints = 0; p.meldConfirmed = false; }
        state.phase = 'playing';
        state.turn = action.seat;
        state.currentTrick = { leader: action.seat, plays: [], winner: null };
        log(state, `${SEAT_NAMES[state.sittingOut]} is sitting out; cards stay face down`);
        log(state, 'No meld; take every trick alone');
      }
      break;
    }
    case 'decline_shoot':
      requireAction(legal.canDeclineShoot, 'You cannot decline a shoot now');
      log(state, `${name} plays it out`);
      startMeld(state);
      break;
    case 'misdeal': {
      requireAction(legal.canMisdeal, 'You cannot throw this hand in');
      const hand = [...player.hand];
      const nines = hand.filter(card => card[0] === '9').length;
      log(state, `${name} throws in ${nines} nines and no meld; ${SEAT_NAMES[state.dealer]} redeals`);
      state.handNumber++;
      deal(state);
      state.misdeal = { seat: action.seat, hand };
      break;
    }
    case 'bid':
      requireAction(legal.canBid, 'You cannot bid now');
      requireAction(Number.isSafeInteger(action.amount) && action.amount >= (legal.minBid ?? Infinity)
        && action.amount % state.rules.bidStep === 0, `Bid must be at least ${legal.minBid} in multiples of ${state.rules.bidStep}`);
      state.highBid = { seat: action.seat, amount: action.amount };
      state.bids.push({ ...state.highBid });
      log(state, `${name} bids ${action.amount}`);
      finishBiddingAction(state);
      break;
    case 'pass_bid':
      requireAction(legal.canPassBid, 'You cannot pass the bid now');
      state.bids.push({ seat: action.seat, amount: null });
      log(state, `${name} passes`);
      finishBiddingAction(state);
      break;
    case 'declare_trump':
      requireAction(legal.canDeclareTrump, 'Only the bidder may declare trump now');
      requireAction(SUITS.includes(action.suit), 'Invalid trump suit');
      state.trump = action.suit;
      log(state, `${name} declares ${{ S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' }[action.suit]}`);
      if (state.rules.passCount) {
        state.phase = 'passing_to_bidder';
        state.turn = partner(action.seat);
      } else afterPass(state);
      break;
    case 'pass_cards': {
      requireAction(legal.mustPassCount !== null, 'You cannot pass cards now');
      selectedCards(player, action.cards);
      requireAction(action.cards.length === legal.mustPassCount, `Pass exactly ${legal.mustPassCount} cards`);
      requireAction(state.bidder !== null, 'No bidder');
      const receiving = state.phase === 'passing_to_bidder' ? state.bidder : partner(state.bidder);
      (state.passedOut ??= emptyHands())[action.seat].push(...action.cards);
      (state.passedIn ??= emptyHands())[receiving].push(...action.cards);
      player.hand = player.hand.filter(card => !action.cards.includes(card));
      state.players[receiving].hand.push(...action.cards);
      // Transfer is atomic; no pending face-down cards need to be retained.
      player.passBuffer = [];
      log(state, `${name} passes ${action.cards.length} cards to ${SEAT_NAMES[receiving]}`);
      if (state.phase === 'passing_to_bidder') {
        state.phase = 'passing_back';
        state.turn = state.bidder;
      } else afterPass(state);
      break;
    }
    case 'declare_meld': {
      requireAction(legal.canDeclareMeld, 'You cannot declare meld now');
      selectedCards(player, action.cards);
      requireAction(state.trump !== null, 'No trump declared');
      const meld = computeMeld(action.cards, state.trump, state.rules);
      player.meld = meld.items;
      player.meldPoints = meld.total;
      log(state, `${name} melds ${meld.total}`);
      break;
    }
    case 'confirm_meld':
      requireAction(legal.canConfirmMeld, 'You cannot confirm meld now');
      player.meldConfirmed = true;
      log(state, `${name} confirms meld`);
      if (state.players.every(p => p.meldConfirmed)) {
        requireAction(state.bidder !== null, 'No bidder');
        state.handsAtPlay = snapshotHands(state);
        state.phase = 'playing';
        state.turn = state.bidder;
        state.currentTrick = { leader: state.bidder, plays: [], winner: null };
        log(state, 'Meld confirmed; trick play begins');
      }
      break;
    case 'play_card': {
      requireAction(legal.playableCards.includes(action.card), 'That card cannot be played now; follow suit and head or trump the trick when able');
      requireAction(state.currentTrick !== null && state.trump !== null, 'No active trick');
      playCard(state, action.seat, action.card);
      break;
    }
    case 'claim': {
      requireAction(legal.canClaim, 'You cannot claim the rest now');
      const line = claimLine({ phase: state.phase, seat: action.seat, turn: state.turn, hand: player.hand,
        playedCards: state.playedCards ?? [], currentTrick: state.currentTrick, trump: state.trump });
      requireAction(line !== null && state.trump !== null, 'No proven claim line');
      state.claim = { seat: action.seat, fromTrick: state.tricksTaken.red.length + state.tricksTaken.blue.length + 1, hands: snapshotHands(state) };
      log(state, `${name} claims the rest.`);
      // Replies use actual hands only AFTER the proof. Every choice loses; play them legally so
      // counters, trick records, meld saving, shoots and the last-trick bonus use ordinary scoring.
      for (const card of line) {
        playCard(state, action.seat, card, true);
        for (let n = 1; n < 4; n++) {
          const seat = ((action.seat + n) % 4) as SeatIndex;
          if (seat === state.sittingOut) continue;
          const reply = legalPlays(state.players[seat].hand, state.currentTrick!, state.trump)[0];
          playCard(state, seat, reply, true);
        }
      }
      break;
    }
    case 'next_hand':
      requireAction(legal.canAdvanceHand, 'The hand cannot be advanced now');
      state.dealer = nextSeat(state.dealer);
      state.handNumber++;
      deal(state);
      break;
    default:
      throw new IllegalAction('Unknown action type');
  }
  state.rev++;
  return state;
}

/** Older records combine counters and last-trick points, so keep them together. */
export function normaliseHandRecord(h: Omit<HandRecord, 'breakdown'> & { breakdown?: HandRecord['breakdown'] }): HandRecord {
  if (h.breakdown) return h as HandRecord;
  const bidding = teamOf(h.bidder);
  const forTeam = (team: Team): HandScoreBreakdown => {
    const result = { meldDeclared: h.meld[team], meldSaved: 0, counters: 0, lastTrick: 0, setPenalty: 0, shoot: 0 };
    if (h.shotMade !== undefined) {
      // No mode was stored. A bidder's delta is the stake; defenders may score normally.
      if (team === bidding || h.delta[team] !== h.meld[team] + h.tricks[team]) result.shoot = h.delta[team];
      else { result.meldSaved = h.meld[team]; result.counters = h.tricks[team]; }
    } else if (h.wentSet && team === bidding) result.setPenalty = -h.delta[team];
    else {
      result.counters = h.tricks[team];
      result.meldSaved = h.delta[team] - result.counters;
    }
    return result;
  };
  return { ...h, breakdown: { red: forTeam('red'), blue: forTeam('blue') } };
}

export function viewFor(state: GameState, seat: SeatIndex): PlayerView {
  state = { ...state, rules: resolveRules(state.rules, true) };
  const legal = legalActionsFor(state, seat);
  const sittingOut = state.sittingOut ?? null;
  const hidden = sittingOut !== null && state.phase !== 'hand_over' && state.phase !== 'game_over';
  const setAside = new Set(hidden ? state.players[sittingOut!].hand : []);
  const visiblePass = (cards: CardId[]) => cards.filter(card => !setAside.has(card));
  const melds = { 0: state.players[0].meld, 1: state.players[1].meld, 2: state.players[2].meld, 3: state.players[3].meld };
  const meldConfirmed = { 0: state.players[0].meldConfirmed, 1: state.players[1].meldConfirmed, 2: state.players[2].meldConfirmed, 3: state.players[3].meldConfirmed };
  return clone({
    recap: {
      handNumber: state.handNumber, dealer: state.dealer, bids: state.bids,
      bidder: state.bidder, bid: state.highBid?.amount ?? null, trump: state.trump,
      passing: { done: ['deciding_shoot', 'melding', 'playing', 'hand_over', 'game_over'].includes(state.phase), count: state.rules.passCount },
      myPassedOut: visiblePass((state as EngineState).passedOut?.[seat] ?? []),
      myPassedIn: visiblePass((state as EngineState).passedIn?.[seat] ?? []),
      melds: Object.fromEntries(state.players.map(p => [p.seat, { items: p.meld, points: p.meldPoints }])) as HandRecap['melds'],
      tricks: (state as EngineState).completedTricks ?? [], current: state.currentTrick,
      trickCounts: { red: state.tricksTaken.red.length, blue: state.tricksTaken.blue.length },
      counters: { red: sittingOut !== null ? 0 : countCounters(state.tricksTaken.red.flat(), state.rules), blue: sittingOut !== null ? 0 : countCounters(state.tricksTaken.blue.flat(), state.rules) },
    },
    seat, phase: state.phase, handNumber: state.handNumber, dealer: state.dealer,
    turn: state.turn, rules: state.rules, sittingOut, hand: hidden && seat === sittingOut ? [] : state.players[seat].hand,
    handCounts: state.players.map(p => p.hand.length) as PlayerView['handCounts'],
    melds, meldConfirmed, bids: state.bids, highBid: state.highBid,
    bidder: state.bidder, trump: state.trump, currentTrick: state.currentTrick,
    lastTrick: (state as EngineState).lastTrick ?? null,
    claim: state.phase === 'hand_over' || state.phase === 'game_over' ? (state as EngineState).claim ?? null : null,
    playedCards: (state as EngineState).playedCards ?? [],
    revealed: state.rules.revealHands && (state.phase === 'hand_over' || state.phase === 'game_over')
      ? { dealt: (state as EngineState).handsDealt ?? emptyHands(), atPlay: (state as EngineState).handsAtPlay ?? emptyHands() }
      : null,
    misdeal: state.phase === 'bidding' ? (state as EngineState).misdeal ?? null : null,
    trickCounts: { red: state.tricksTaken.red.length, blue: state.tricksTaken.blue.length },
    score: state.score, history: state.history.map(normaliseHandRecord), winner: state.winner, rev: state.rev, log: state.log, legal,
  });
}
