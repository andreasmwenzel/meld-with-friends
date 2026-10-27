import { describe, expect, it } from 'vitest';
import { applyAction, newGame, viewFor } from '../game';
import { fuzzRules } from '../fuzz';
import { actors, botAction, buildScenario, stackDeal } from '../scenario';
import { PRESETS } from '../scenarios';
import { applyPublicMove, publicMove, type PublicMove } from '../publicMove';
import type { Action, CardId, GameState, SeatIndex } from '../types';

const SEATS = [0, 1, 2, 3] as const;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const CARD = /^[ATKQJ9][SHDC][01]$/;
function cardsIn(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (typeof value === 'string') { if (CARD.test(value)) out.add(value); }
  else if (Array.isArray(value)) value.forEach(v => cardsIn(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach(v => cardsIn(v, out));
  return out;
}

/** Cards everyone at the table may see: played, taken, on the table, declared as meld, or a hand thrown in for nines. */
function publicCards(state: GameState): Set<string> {
  const s = state as GameState & { playedCards?: { card: CardId }[]; misdeal?: { hand: CardId[] } | null };
  return new Set<string>([
    ...(s.playedCards ?? []).map(p => p.card),
    ...state.tricksTaken.red.flat(), ...state.tricksTaken.blue.flat(),
    ...(state.currentTrick?.plays.map(p => p.card) ?? []),
    ...state.players.flatMap(p => p.meld.flatMap(m => m.cards)),
    ...(s.misdeal?.hand ?? []),
  ]);
}

const canonical = (value: unknown): string => JSON.stringify(value, (_key, v) =>
  v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);

interface Step { prev: GameState; next: GameState; action: Action; move: PublicMove | null }

/** Play whole games with real bots and random rules, recording every move. */
function* games(count: number, prefix: string): Generator<Step> {
  for (let i = 0; i < count; i++) {
    let state = newGame(`${prefix}:${i}`, fuzzRules(i * 2654435761 >>> 0), (i % 4) as SeatIndex);
    for (let n = 0; state.phase !== 'game_over' && n < 3000; n++) {
      const seat = state.phase === 'hand_over' ? 0 : actors(state)[0];
      const action = state.phase === 'hand_over' ? { type: 'next_hand', seat } as Action : botAction(state, seat);
      const next = applyAction(state, action);
      yield { prev: state, next, action, move: publicMove(state, next, action) };
      state = next;
    }
  }
}

describe('public moves', () => {
  const steps = [...games(8, 'public-move')];

  it('apply to every seat\'s view to give exactly the view the server would send', () => {
    let applied = 0;
    for (const { prev, next, move } of steps) {
      if (!move) continue;
      for (const seat of SEATS) {
        const got = applyPublicMove(viewFor(prev, seat), move), want = viewFor(next, seat);
        // Compare as JSON with sorted keys first (fast); fall back to toEqual for a readable diff.
        if (canonical(got) !== canonical(want)) expect(got, `seat ${seat} rev ${next.rev}`).toEqual(want);
      }
      applied++;
    }
    expect(applied).toBeGreaterThan(steps.length * 0.8);
  }, 60000);

  it('carry no card that is not already public', () => {
    for (const { next, move } of steps) {
      if (!move) continue;
      const allowed = publicCards(next);
      const leaked = [...cardsIn(move)].filter(card => !allowed.has(card));
      expect(leaked, `${move.action.type} at rev ${move.rev}`).toEqual([]);
    }
  });

  it('cover every bid and every card play that does not end the hand', () => {
    for (const { prev, next, action, move } of steps) {
      const endsHand = next.phase === 'hand_over' || next.phase === 'game_over';
      const redealt = SEATS.some(seat => !same(prev.players[seat].hand, next.players[seat].hand));
      if (action.type === 'play_card' && !endsHand) expect(move, `play at rev ${next.rev}`).not.toBeNull();
      if ((action.type === 'bid' || action.type === 'pass_bid' || action.type === 'shoot') && !redealt) expect(move, `${action.type} at rev ${next.rev}`).not.toBeNull();
    }
  });

  it('are never made for a deal, passing cards, or the end of a hand', () => {
    for (const { prev, next, action, move } of steps) {
      if (action.type === 'next_hand' || action.type === 'pass_cards' || action.type === 'misdeal') expect(move).toBeNull();
      if (next.phase === 'hand_over' || next.phase === 'game_over' || next.handNumber !== prev.handNumber) expect(move).toBeNull();
    }
  });

  it('leave out the cards a meld declaration chose', () => {
    const meld = steps.find(s => s.action.type === 'declare_meld' && s.move);
    expect(meld?.move?.action).toEqual({ type: 'declare_meld', seat: meld!.action.seat });
  });

  it('refuse a view that is not exactly one revision behind', () => {
    const step = steps.find(s => s.move && s.action.type === 'play_card')!;
    const view = viewFor(step.prev, 0);
    expect(applyPublicMove({ ...view, rev: view.rev - 1 }, step.move!)).toBeNull();
    expect(applyPublicMove(viewFor(step.next, 0), step.move!)).toBeNull();
  });
});

/** Replay a lab preset from its start, pairing each action with the public move it would broadcast. */
function presetSteps(id: string): Step[] {
  const { base, actions } = buildScenario(PRESETS.find(p => p.id === id)!.spec);
  let state = base;
  return actions.map(action => {
    const next = applyAction(state, action);
    const step = { prev: state, next, action, move: publicMove(state, next, action) };
    state = next;
    return step;
  });
}

// The generated games above rarely shoot or throw in a hand, so both are pinned here.
describe('public moves for shoots and misdeals', () => {
  it.each(['hand-shoot-made', 'hand-shoot-missed', 'game-shoot-win'])('%s: the shoot call is public, the action that ends the hand is not', id => {
    const steps = presetSteps(id);
    const shoot = steps.find(s => s.action.type === 'shoot')!;
    expect(shoot.move?.action).toEqual({ type: 'shoot', seat: shoot.action.seat });
    const last = steps.at(-1)!;
    expect(last.action.type).toBe(id === 'hand-shoot-missed' ? 'play_card' : 'claim');
    expect(['hand_over', 'game_over']).toContain(last.next.phase);
    expect(last.move).toBeNull();
    for (const { prev, move } of steps.filter(s => s.move)) for (const seat of SEATS) expect(applyPublicMove(viewFor(prev, seat), move!)).not.toBeNull();
  });

  it('a missed shoot ends the hand early, on the first trick lost, with no move', () => {
    const steps = presetSteps('hand-shoot-missed');
    expect(steps.at(-1)!.next.players.some(p => p.hand.length > 0)).toBe(true);
    expect(steps.at(-1)!.move).toBeNull();
  });

  it('a nines misdeal is never a move, since it redeals', () => {
    // Five nines and no other meld for South; East deals, so South calls first.
    const nines = ['9S', '9S', '9H', '9H', '9D', 'AS', 'AS', 'TS', 'TH', 'TD', 'AC', 'TC'];
    const state = stackDeal(newGame('nines', {}, 3), { 0: nines });
    const action: Action = { type: 'misdeal', seat: 0 };
    const next = applyAction(state, action);
    expect(next.handNumber).toBe(state.handNumber + 1);
    expect(publicMove(state, next, action)).toBeNull();
  });
});
