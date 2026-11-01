import { IllegalAction } from '../types';
import { buildHeartsDeck, cardPoints, heartsCardLabel, isPenaltyCard, parseHeartsCard, rankValue, seededHeartsShuffle } from './deck';
import { DEFAULT_HEARTS_RULES } from './types';
import type { HeartsAction, HeartsCardId, HeartsPlayReason, HeartsRules, HeartsState, HeartsView, PassDirection, Penalties, SeatIndex } from './types';

const SEATS = [0, 1, 2, 3] as const;
const NAMES = ['South', 'West', 'North', 'East'];
const nextSeat = (seat: number, offset = 1) => ((seat + offset) % 4) as SeatIndex;
const perSeat = <T>(fn: (seat: SeatIndex) => T): Record<SeatIndex, T> => ({ 0: fn(0), 1: fn(1), 2: fn(2), 3: fn(3) });

export function resolveHeartsRules(partial: Partial<HeartsRules> = {}): HeartsRules {
  const p = partial ?? {};
  return {
    pace: p.pace === 'leisurely' || p.pace === 'live' ? p.pace : DEFAULT_HEARTS_RULES.pace,
    target: typeof p.target === 'number' && Number.isSafeInteger(p.target) && p.target > 0 ? p.target : DEFAULT_HEARTS_RULES.target,
    passing: p.passing === 'none' || p.passing === 'rotate' ? p.passing : DEFAULT_HEARTS_RULES.passing,
    moon: p.moon === 'add' || p.moon === 'subtract' ? p.moon : DEFAULT_HEARTS_RULES.moon,
    jackOfDiamonds: typeof p.jackOfDiamonds === 'boolean' ? p.jackOfDiamonds : DEFAULT_HEARTS_RULES.jackOfDiamonds,
    noPointsFirstTrick: typeof p.noPointsFirstTrick === 'boolean' ? p.noPointsFirstTrick : DEFAULT_HEARTS_RULES.noPointsFirstTrick,
  };
}

function beginPlay(state: HeartsState): void {
  const leader = state.players.find(p => p.hand.includes('2C'))!.seat;
  state.phase = 'playing';
  state.turn = leader;
  state.currentTrick = { leader, plays: [], winner: null };
  state.heartsBroken = false;
}

function deal(state: HeartsState): void {
  const cards = seededHeartsShuffle(buildHeartsDeck(), `${state.seed}:${state.handNumber}`);
  state.players.forEach(p => { p.hand = []; p.taken = []; p.passBuffer = []; p.passed = false; });
  cards.forEach((card, i) => state.players[nextSeat(state.dealer, i + 1)].hand.push(card));
  state.pass = state.rules.passing === 'none' ? 'hold' : (['left', 'right', 'across', 'hold'] as PassDirection[])[(state.handNumber - 1) % 4];
  state.received = perSeat(() => []);
  state.tricks = [];
  state.lastTrick = null;
  state.currentTrick = null;
  state.heartsBroken = false;
  state.turn = null;
  state.phase = 'passing';
  if (state.pass === 'hold') {
    state.players.forEach(p => { p.passed = true; });
    beginPlay(state);
  }
}

export function newHeartsGame(seed: string, rules: Partial<HeartsRules> = {}, dealer: SeatIndex = 0): HeartsState {
  if (!SEATS.includes(dealer)) throw new IllegalAction('Invalid dealer');
  const player = (seat: SeatIndex) => ({ seat, hand: [], taken: [], passBuffer: [], passed: false });
  const state: HeartsState = {
    version: 1, kind: 'hearts', seed, rules: resolveHeartsRules(rules), dealer, handNumber: 1,
    phase: 'passing', turn: null, players: [player(0), player(1), player(2), player(3)],
    pass: 'left', received: perSeat(() => []), currentTrick: null, lastTrick: null, tricks: [],
    heartsBroken: false, score: perSeat(() => 0), history: [], winner: null, rev: 0, log: [],
  };
  deal(state);
  return state;
}

/** Follow-suit takes precedence over the first-trick restriction. */
function playOptions(state: HeartsState, seat: SeatIndex): { cards: HeartsCardId[]; reason: HeartsPlayReason | null } {
  if (state.phase !== 'playing' || state.turn !== seat || !state.currentTrick) return { cards: [], reason: null };
  const hand = state.players[seat].hand;
  const plays = state.currentTrick.plays;
  const first = state.tricks.length === 0;
  if (!plays.length && first) return { cards: hand.filter(c => c === '2C'), reason: 'lead_two_clubs' };
  if (plays.length) {
    const suit = parseHeartsCard(plays[0].card).suit;
    const following = hand.filter(c => parseHeartsCard(c).suit === suit);
    if (following.length) return { cards: following, reason: 'follow_suit' };
    if (first && state.rules.noPointsFirstTrick) {
      const safe = hand.filter(c => !isPenaltyCard(c, state.rules));
      if (safe.length) return { cards: safe, reason: 'no_points_first_trick' };
    }
    return { cards: [...hand], reason: 'any' };
  }
  if (!state.heartsBroken) {
    const nonHearts = hand.filter(c => parseHeartsCard(c).suit !== 'H');
    if (nonHearts.length) return { cards: nonHearts, reason: 'hearts_not_broken' };
  }
  return { cards: [...hand], reason: 'lead_any' };
}

export function legalPlays(state: HeartsState, seat: SeatIndex): HeartsCardId[] {
  return playOptions(state, seat).cards;
}

export function playReason(state: HeartsState, seat: SeatIndex): HeartsPlayReason | null {
  return playOptions(state, seat).reason;
}

function penalties(cards: HeartsCardId[], rules: HeartsRules): Penalties {
  return {
    hearts: cards.filter(c => parseHeartsCard(c).suit === 'H').length,
    queen: cards.includes('QS'), jack: rules.jackOfDiamonds && cards.includes('JD'),
    points: cards.reduce((sum, card) => sum + cardPoints(card, rules), 0),
  };
}

function finishHand(state: HeartsState): void {
  const counts = perSeat(s => penalties(state.players[s].taken, state.rules));
  const taken = perSeat(s => counts[s].points);
  const moon = SEATS.find(s => counts[s].hearts === 13 && counts[s].queen) ?? null;
  const delta = perSeat(s => {
    if (moon === null) return taken[s];
    const base = state.rules.moon === 'add' ? (s === moon ? 0 : 26) : (s === moon ? -26 : 0);
    return base - (counts[s].jack ? 10 : 0);
  });
  if (moon !== null) state.log.push(`${NAMES[moon]} shot the moon`);
  state.history.push({ handNumber: state.handNumber, dealer: state.dealer, pass: state.pass, taken, delta, moon });
  for (const seat of SEATS) state.score[seat] += delta[seat];
  state.log.push(`Hand ${state.handNumber}: ${SEATS.map(s => `${NAMES[s]} ${delta[s]}`).join(', ')}`);
  state.phase = 'hand_over';
  state.turn = null;
  if (SEATS.some(s => state.score[s] >= state.rules.target)) {
    const low = Math.min(...SEATS.map(s => state.score[s]));
    const winners = SEATS.filter(s => state.score[s] === low);
    if (winners.length === 1) { state.winner = winners[0]; state.phase = 'game_over'; }
  }
}

export function applyHeartsAction(state: HeartsState, action: HeartsAction): HeartsState {
  if (!action || !SEATS.includes(action.seat)) throw new IllegalAction('Invalid seat');
  const next = structuredClone(state);
  const player = next.players[action.seat];
  switch (action.type) {
    case 'pass_cards': {
      if (next.phase !== 'passing' || player.passed) throw new IllegalAction('Cannot pass now');
      if (!Array.isArray(action.cards) || action.cards.length !== 3 || new Set(action.cards).size !== 3) throw new IllegalAction('Pass three distinct cards');
      if (!action.cards.every(c => player.hand.includes(c))) throw new IllegalAction('Card not in your hand');
      player.passBuffer = [...action.cards];
      player.hand = player.hand.filter(c => !action.cards.includes(c));
      player.passed = true;
      next.log.push(`${NAMES[action.seat]} passes three cards`);
      if (next.players.every(p => p.passed)) {
        const offset = next.pass === 'left' ? 1 : next.pass === 'right' ? 3 : 2;
        for (const seat of SEATS) {
          const recipient = nextSeat(seat, offset);
          next.received[recipient] = [...next.players[seat].passBuffer];
          next.players[recipient].hand.push(...next.players[seat].passBuffer);
        }
        next.players.forEach(p => { p.passBuffer = []; });
        beginPlay(next);
      }
      break;
    }
    case 'play_card': {
      if (!legalPlays(next, action.seat).includes(action.card)) throw new IllegalAction('Card cannot be played');
      const trick = next.currentTrick!;
      const leading = trick.plays.length === 0;
      player.hand = player.hand.filter(c => c !== action.card);
      next.received[action.seat] = [];
      if (parseHeartsCard(action.card).suit === 'H' && !leading && parseHeartsCard(trick.plays[0].card).suit !== 'H') next.heartsBroken = true;
      trick.plays.push({ seat: action.seat, card: action.card });
      next.log.push(`${NAMES[action.seat]} ${leading ? 'leads' : 'plays'} ${heartsCardLabel(action.card)}`);
      if (trick.plays.length < 4) next.turn = nextSeat(action.seat);
      else {
        const suit = parseHeartsCard(trick.plays[0].card).suit;
        const best = trick.plays.filter(p => parseHeartsCard(p.card).suit === suit)
          .reduce((a, b) => rankValue(parseHeartsCard(a.card).rank) > rankValue(parseHeartsCard(b.card).rank) ? a : b);
        trick.winner = best.seat;
        const cards = trick.plays.map(p => p.card);
        next.players[best.seat].taken.push(...cards);
        next.tricks.push(trick);
        next.lastTrick = trick;
        next.log.push(`${NAMES[best.seat]} takes the trick (${cards.reduce((n, c) => n + cardPoints(c, next.rules), 0)} points)`);
        next.currentTrick = { leader: best.seat, plays: [], winner: null };
        next.turn = best.seat;
        if (next.tricks.length === 13) { next.currentTrick = null; finishHand(next); }
      }
      break;
    }
    case 'next_hand':
      if (next.phase !== 'hand_over') throw new IllegalAction('Hand is not over');
      next.handNumber++;
      next.dealer = nextSeat(next.dealer);
      deal(next);
      next.log.push(`Hand ${next.handNumber}: pass ${next.pass}`);
      break;
    default: throw new IllegalAction('Unknown action');
  }
  next.rev++;
  next.log = next.log.slice(-50);
  return next;
}

export function heartsViewFor(state: HeartsState, seat: SeatIndex): HeartsView {
  const options = playOptions(state, seat);
  return structuredClone({
    kind: 'hearts', seat, phase: state.phase, handNumber: state.handNumber, dealer: state.dealer,
    turn: state.turn, rules: state.rules, hand: state.players[seat].hand,
    handCounts: state.players.map(p => p.hand.length) as HeartsView['handCounts'], pass: state.pass,
    passed: perSeat(s => state.players[s].passed), received: state.received[seat],
    currentTrick: state.currentTrick, lastTrick: state.lastTrick, heartsBroken: state.heartsBroken,
    playedCards: [...state.tricks.flatMap(t => t.plays), ...(state.currentTrick?.plays ?? [])],
    taken: perSeat(s => penalties(state.players[s].taken, state.rules)),
    tricksTaken: perSeat(s => state.tricks.filter(t => t.winner === s).length),
    score: state.score, history: state.history, winner: state.winner, rev: state.rev, log: state.log,
    legal: {
      mustPassCount: state.phase === 'passing' && !state.players[seat].passed ? 3 : null,
      playableCards: options.cards, playReason: options.reason, canAdvanceHand: state.phase === 'hand_over',
    },
  });
}
