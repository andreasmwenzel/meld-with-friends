import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';
import { applyAction, newGame, viewFor } from '@/engine/game';
import { fuzzRules } from '@/engine/fuzz';
import { actors, botAction, buildScenario, stackDeal } from '@/engine/scenario';
import { PRESETS } from '@/engine/scenarios';
import { applyPublicMove, type PublicMove } from '@/engine/publicMove';
import type { Action, CardId, GameState, PlayerView, SeatIndex } from '@/engine/types';
import { moveMessage, openMove } from '@/lib/moveAuth';
import { BUILD_ID } from '@/lib/staleClient';
import { ViewSync } from '@/components/table/viewSync';
vi.mock('../push', () => ({ scheduleTurnNotification: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }));
vi.mock('../tables', () => ({ tableByCode: vi.fn() }));
vi.mock('../realtime', () => ({ broadcastTable: vi.fn() }));
import { gameEvent } from '../game';
import { movePublicKey } from '../moveSigning';

const SEATS = [0, 1, 2, 3] as const;
const GAME = 'game-id';
const CARD = /\b[ATKQJ9][SHDC][01]\b/g;

beforeEach(() => {
  for (const [key, value] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: 'https://meld.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service-role', CRON_SECRET: 'cron' })) vi.stubEnv(key, value);
});

/** Cards every seat may see after `state`: played, taken, on the table, or declared as meld. */
function publicCards(state: GameState): Set<string> {
  const s = state as GameState & { playedCards?: { card: CardId }[] };
  return new Set<string>([
    ...(s.playedCards ?? []).map(p => p.card),
    ...state.tricksTaken.red.flat(), ...state.tricksTaken.blue.flat(),
    ...(state.currentTrick?.plays.map(p => p.card) ?? []),
    ...state.players.flatMap(p => p.meld.flatMap(m => m.cards)),
  ]);
}

/** Play a whole game with bots, returning each committed move and the broadcast the server would send. */
function playGame(seed: string, rules: ReturnType<typeof fuzzRules>) {
  let state = newGame(seed, rules);
  const steps: { prev: GameState; next: GameState; action: Action; event: ReturnType<typeof gameEvent> }[] = [];
  while (state.phase !== 'game_over' && steps.length < 3000) {
    const seat = state.phase === 'hand_over' ? 0 : actors(state)[0];
    const action = state.phase === 'hand_over' ? { type: 'next_hand', seat } as Action : botAction(state, seat);
    const next = applyAction(state, action);
    steps.push({ prev: state, next, action, event: gameEvent(GAME, state, next, action) });
    state = next;
  }
  return { steps, final: state };
}

describe('the game broadcast', () => {
  it('never carries a card that is still hidden', () => {
    for (let i = 0; i < 4; i++) {
      const { steps } = playGame(`payload:${i}`, fuzzRules(i));
      let moves = 0;
      for (const { next, event } of steps) {
        const text = JSON.stringify(event);
        if (!event.move) { expect(text).toBe(JSON.stringify({ type: 'game', rev: next.rev })); continue; }
        moves++;
        const allowed = publicCards(next);
        expect([...event.move.matchAll(CARD)].map(m => m[0]).filter(card => !allowed.has(card)), `rev ${next.rev}`).toEqual([]);
      }
      expect(moves).toBeGreaterThan(steps.length / 2);
    }
  }, 60000);

  it('describes bids and card plays, and leaves deals and new hands to a fetch', () => {
    const { steps } = playGame('kinds', {});
    for (const { prev, next, action, event } of steps) {
      if (action.type === 'next_hand' || next.handNumber !== prev.handNumber || next.phase === 'hand_over') expect(event).not.toHaveProperty('move');
      if (action.type === 'play_card' && next.phase === 'playing') expect(event).toHaveProperty('move');
    }
  });

  it('is signed by the server for this game only', async () => {
    const { steps } = playGame('signed', {});
    const signed = steps.find(s => s.event.move)!.event;
    expect(await openMove(movePublicKey(), GAME, signed.move, signed.sig)).not.toBeNull();
    expect(await openMove(movePublicKey(), 'another-game', signed.move, signed.sig)).toBeNull();
    const forged = signed.move!.replace(/"rev":(\d+)/, (_m, n) => `"rev":${Number(n) + 1}`);
    expect(await openMove(movePublicKey(), GAME, forged, signed.sig)).toBeNull();
    expect(await openMove(movePublicKey(), GAME, signed.move!.replace(`"build":"${BUILD_ID}"`, '"build":"forged-build"'), signed.sig)).toBeNull();
    expect(await openMove(movePublicKey(), GAME, signed.move, signed.sig)).toMatchObject({ build: BUILD_ID });
  });

  it('is a bare revision for a nines misdeal and for the play that ends a shoot', () => {
    const nines = stackDeal(newGame('nines', {}, 3), { 0: ['9S', '9S', '9H', '9H', '9D', 'AS', 'AS', 'TS', 'TH', 'TD', 'AC', 'TC'] });
    const misdeal: Action = { type: 'misdeal', seat: 0 };
    const redealt = applyAction(nines, misdeal);
    expect(gameEvent(GAME, nines, redealt, misdeal)).toEqual({ type: 'game', rev: redealt.rev });
    for (const id of ['hand-shoot-made', 'hand-shoot-missed']) {
      const { base, actions, state } = buildScenario(PRESETS.find(p => p.id === id)!.spec);
      const before = actions.slice(0, -1).reduce(applyAction, base);
      expect(state.phase, id).toBe('hand_over');
      expect(gameEvent(GAME, before, state, actions.at(-1)!), id).toEqual({ type: 'game', rev: state.rev });
    }
  });
});

/** One seat's tab: a ViewSync over a server that answers /view with the current engine state. */
function tab(seat: SeatIndex, server: { state: GameState; fetches: number }) {
  let shown: PlayerView | null = null;
  let applied = 0;
  const sync = new ViewSync<PlayerView, PublicMove>({
    fetchView: async () => { server.fetches++; return { ...viewFor(server.state, seat), moveKey: movePublicKey() } as PlayerView; },
    applyMove: (view, move) => { applied++; return applyPublicMove(view, move); },
    apply: view => { shown = view; },
    onError: e => { throw e; },
  });
  /** What the board does with a channel event: check the signature, then hand the move to the sync. */
  const receive = async (event: ReturnType<typeof gameEvent>) => {
    const move = event.move ? await openMove(movePublicKey(), GAME, event.move, event.sig) : null;
    sync.event(event.rev, move?.build === BUILD_ID ? move.move : undefined);
  };
  return { sync, receive, get shown() { return shown; }, get applied() { return applied; } };
}
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 0)); };

describe('a move signed with another key', () => {
  it('is never applied: the tab fetches its view once and shows the server\'s', async () => {
    const { steps } = playGame('wrong-key', {});
    const step = steps.find(s => s.event.move && s.action.type === 'play_card')!;
    const server = { state: step.prev, fetches: 0 };
    const t = tab(0, server);
    await t.sync.load();
    server.fetches = 0;
    // A valid move for this game and revision, signed by someone who is not the server.
    const move = JSON.parse(step.event.move!).move as PublicMove;
    const message = moveMessage(GAME, move, BUILD_ID);
    const { privateKey } = generateKeyPairSync('ed25519');
    const forged = { type: 'game' as const, rev: step.next.rev, move: message, sig: sign(null, Buffer.from(message), privateKey).toString('base64url') };
    server.state = step.next;
    await t.receive(forged);
    await settle();
    expect(t.applied).toBe(0);
    expect(server.fetches).toBe(1);
    expect(t.shown).toMatchObject(viewFor(step.next, 0));
    // The same move with the server's own signature applies without a fetch.
    server.state = step.prev;
    const control = tab(0, server);
    await control.sync.load();
    server.fetches = 0;
    server.state = step.next;
    await control.receive(step.event);
    await settle();
    expect(control.applied).toBe(1);
    expect(server.fetches).toBe(0);
  });
});

describe('four tabs applying a whole game from the broadcast', () => {
  it('match the server at every step, fetching only for deals, hand ends and gaps', async () => {
    const { steps, final } = playGame('four-tabs', {});
    const server = { state: steps[0].prev, fetches: 0 };
    const tabs = SEATS.map(seat => tab(seat, server));
    for (const t of tabs) await t.sync.load();
    server.fetches = 0;

    let dropped = 0, swapped = 0, withoutMove = 0;
    for (let i = 0; i < steps.length; i++) {
      server.state = steps[i].next;
      if (!steps[i].event.move) withoutMove++;
      // Tab 1 misses every 17th event; tab 2 gets every 23rd pair out of order.
      for (const seat of SEATS) {
        const t = tabs[seat];
        if (seat === 1 && i % 17 === 5) { dropped++; continue; }
        if (seat === 2 && i % 23 === 7 && i + 1 < steps.length) continue; // delivered after the next one
        if (seat === 2 && i % 23 === 8) {
          swapped++;
          await t.receive(steps[i].event);
          await t.receive(steps[i - 1].event);
          continue;
        }
        await t.receive(steps[i].event);
      }
      await settle();
      for (const seat of SEATS) {
        const t = tabs[seat];
        // A tab that missed this event catches up on the next one, with a fetch.
        if (seat === 1 && i % 17 === 5) continue;
        if (seat === 2 && i % 23 === 7) continue;
        expect(t.shown, `seat ${seat} at rev ${server.state.rev}`).toMatchObject(viewFor(server.state, seat));
      }
    }
    for (const seat of SEATS) expect(tabs[seat].shown).toMatchObject(viewFor(final, seat));
    // Every event without a move costs each tab one fetch; a missed or reordered event costs about one more.
    expect(dropped).toBeGreaterThan(0); expect(swapped).toBeGreaterThan(0);
    expect(server.fetches).toBeGreaterThanOrEqual(withoutMove * 4);
    expect(server.fetches).toBeLessThanOrEqual(withoutMove * 4 + 2 * (dropped + swapped));
    // Most moves are public: far fewer fetches than one per tab per move.
    expect(server.fetches).toBeLessThan(steps.length * 4 / 3);
  }, 60000);
});
