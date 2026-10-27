import { expect, it } from 'vitest';
import { applyAction, legalActionsFor, newGame, viewFor } from '../game';
import { buildDeck, seededShuffle, SUITS } from '../deck';
import { IllegalAction, type Action, type CardId, type GameState, type RulesConfig } from '../types';

const seats = [0, 1, 2, 3] as const;
const deck = buildDeck().sort();
function random(seed: number) {
  let value = seed + 1;
  return () => { value = Math.imul(value, 1664525) + 1013904223 | 0; return (value >>> 0) / 4294967296; };
}
function candidates(state: GameState, rng: () => number): Action[] {
  return seats.flatMap((seat): Action[] => {
    const legal = legalActionsFor(state, seat);
    const actions: Action[] = [];
    if (legal.canBid && legal.minBid! <= 100) actions.push({ type: 'bid', seat, amount: legal.minBid! });
    if (legal.canPassBid) actions.push({ type: 'pass_bid', seat });
    if (legal.canShoot && state.handNumber === 1) actions.push({ type: 'shoot', seat });
    if (legal.canDeclineShoot) actions.push({ type: 'decline_shoot', seat });
    if (legal.canMisdeal) actions.push({ type: 'misdeal', seat });
    if (legal.canDeclareTrump) for (const suit of SUITS) actions.push({ type: 'declare_trump', seat, suit });
    if (legal.mustPassCount !== null) actions.push({ type: 'pass_cards', seat, cards: seededShuffle(state.players[seat].hand, String(rng())).slice(0, legal.mustPassCount) });
    // Declare once, then confirm, so random selection cannot keep melding forever.
    if (legal.canDeclareMeld && !state.players[seat].meld.length) actions.push({ type: 'declare_meld', seat, cards: state.players[seat].hand.filter(() => rng() < 0.8) });
    if (legal.canConfirmMeld) actions.push({ type: 'confirm_meld', seat });
    for (const card of legal.playableCards) actions.push({ type: 'play_card', seat, card });
    if (legal.canAdvanceHand) actions.push({ type: 'next_hand', seat });
    return actions;
  });
}
function conserved(state: GameState) {
  const cards = [
    ...state.players.flatMap(p => [...p.hand, ...p.passBuffer]),
    ...state.tricksTaken.red.flat(), ...state.tricksTaken.blue.flat(),
    ...(state.currentTrick?.plays.map(p => p.card) ?? []),
  ];
  expect(cards.sort()).toEqual(deck);
  // Meld declarations and handsAtPlay are references to cards, not additional piles.
  // Every meld card must belong to that player's hand as trick play began.
  for (const p of state.players) {
    const played = (state as GameState & { playedCards?: { seat: number; card: CardId }[] }).playedCards ?? [];
    const owned = [...p.hand, ...played.filter(c => c.seat === p.seat).map(c => c.card)];
    for (const card of p.meld.flatMap(m => m.cards)) expect(owned).toContain(card);
  }
}

it('plays 200 seeded random full games with conservation, legal actions, illegal attempts, and deterministic replay', () => {
  let earlyFailedShoots = 0;
  const passCounts = new Set<number>();
  for (let seed = 0; seed < 200; seed++) {
    const rng = random(seed);
    const rules: Partial<RulesConfig> = {
      target: 400, minBid: 50, passCount: [0, 4, 5][seed % 3],
      counting: seed % 2 ? 'classic' : 'tens', shoot: seed % 2 ? 'points' : 'off', shootPoints: 100,
      dealerStuck: seed % 4 !== 0,
    };
    passCounts.add(rules.passCount!);
    let state = newGame(`invariants:${seed}`, rules);
    const actions: Action[] = [];
    while (state.phase !== 'game_over' && actions.length < 5000) {
      conserved(state);
      const possible = candidates(state, rng);
      expect(possible.length).toBeGreaterThan(0);
      const action = possible[Math.floor(rng() * possible.length)];
      // Compare independently exposed legal actions with the chosen action's permission.
      const legal = viewFor(state, action.seat).legal;
      expect(legal).toEqual(legalActionsFor(state, action.seat));
      if (action.type === 'play_card') expect(legal.playableCards).toContain(action.card);
      else if (action.type === 'pass_cards') expect(action.cards).toHaveLength(legal.mustPassCount!);
      else expect(legal[({ bid: 'canBid', pass_bid: 'canPassBid', shoot: 'canShoot', decline_shoot: 'canDeclineShoot', misdeal: 'canMisdeal', declare_trump: 'canDeclareTrump', declare_meld: 'canDeclareMeld', confirm_meld: 'canConfirmMeld', next_hand: 'canAdvanceHand' } as const)[action.type]]).toBe(true);
      const seat = seats[Math.floor(rng() * 4)];
      const forbidden = buildDeck().filter(card => !legalActionsFor(state, seat).playableCards.includes(card));
      const illegal: Action = { type: 'play_card', seat, card: forbidden[Math.floor(rng() * forbidden.length)] as CardId };
      expect(() => applyAction(state, illegal)).toThrow(IllegalAction);
      state = applyAction(state, action);
      actions.push(action);
      if (state.history.at(-1)?.shotMade === false && state.phase === 'hand_over' && state.players.some(p => p.hand.length > 0)) earlyFailedShoots++;
    }
    expect(state.phase, `seed ${seed}`).toBe('game_over');
    conserved(state);
    const replay = actions.reduce((s, action) => applyAction(s, action), newGame(`invariants:${seed}`, rules));
    expect(replay).toEqual(state);
  }
  expect(passCounts).toEqual(new Set([0, 4, 5]));
  expect(earlyFailedShoots).toBeGreaterThan(0);
}, 120000);

it('awards the bidder the game when both teams cross the target in the same hand', () => {
  const rng = random(991);
  let state = newGame('both-cross', { target: 1000, minBid: 10, passCount: 0 });
  // Generate a normal hand until both sides have tricks and a made contract.
  while (state.phase !== 'hand_over') {
    const possible = candidates(state, rng).filter(a => a.type !== 'bid' || !state.highBid);
    state = applyAction(state, possible[Math.floor(rng() * possible.length)]);
  }
  expect(state.history[0].delta.red).toBeGreaterThan(0);
  expect(state.history[0].delta.blue).toBeGreaterThan(0);
  // Replay that hand starting just below target so both cross on its final action.
  let replay = newGame('both-cross', { target: 1000, minBid: 10, passCount: 0 });
  const replayRng = random(991);
  replay.score = { red: 999, blue: 999 };
  while (replay.phase !== 'game_over') {
    const possible = candidates(replay, replayRng).filter(a => a.type !== 'bid' || !replay.highBid);
    replay = applyAction(replay, possible[Math.floor(replayRng() * possible.length)]);
  }
  expect(replay.score.red).toBeGreaterThanOrEqual(1000);
  expect(replay.score.blue).toBeGreaterThanOrEqual(1000);
  expect(replay.winner).toBe(replay.bidder! % 2 === 0 ? 'red' : 'blue');
});
