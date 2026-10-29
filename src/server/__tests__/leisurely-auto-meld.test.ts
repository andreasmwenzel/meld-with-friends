import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildScenario } from '@/engine/scenario';
import { PRESETS } from '@/engine/scenarios';
import { autoMeldSelection } from '@/engine/hand';
import { resolveRules } from '@/engine/scoring';
import type { GameState, SeatIndex } from '@/engine/types';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), commit: vi.fn(), from: vi.fn(), broadcast: vi.fn(), notify: vi.fn(), pace: 'leisurely' }));
vi.mock('../push', () => ({ scheduleTurnNotification: mocks.notify }));
vi.mock('../botTableTalk', () => ({ scheduleHandTalk: () => {} }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: mocks.from, rpc: mocks.rpc }) }));
vi.mock('../tables', () => ({ tableByCode: async () => ({ id: 'table-id', code: 'ABC234', current_game_id: 'game-id', status: 'playing', rules: { pace: mocks.pace } }) }));
vi.mock('../realtime', () => ({ broadcastTable: mocks.broadcast }));
import { botTick } from '../game';

const HUMANS = ['h0', 'h1', 'h2', 'h3'];
let state: GameState;
let prefs: { data: { id: string; auto_meld: boolean }[] | null; error: { message: string } | null };
let seats: { seat: number; user_id: string | null; bot: string | null }[];
beforeEach(() => {
  for (const [key, value] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: "https://meld.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service-role", CRON_SECRET: "cron" })) vi.stubEnv(key, value);
  vi.clearAllMocks();
  mocks.pace = 'leisurely';
  state = buildScenario({ ...PRESETS.find(p => p.id === 'meld-double-run')!.spec, rules: resolveRules({ scoring: 'modern', passCount: 0, pace: 'leisurely' }) }).state;
  seats = HUMANS.map((user_id, seat) => ({ seat, user_id, bot: null }));
  prefs = { data: HUMANS.map(id => ({ id, auto_meld: id !== 'h2' })), error: null };
  mocks.rpc.mockImplementation((name: string, args: unknown) => name === 'consume_rate' ? { data: true, error: null } : mocks.commit(name, args));
  // Each commit succeeds and returns the revision it wrote.
  mocks.commit.mockImplementation(async (_name: string, args: { p_state: GameState }) => ({ data: args.p_state.rev, error: null }));
  mocks.from.mockImplementation((name: string) => {
    if (name === 'profiles') return { select: () => ({ in: async () => prefs }) };
    const result = name === 'seats' ? { data: seats, error: null } : { data: { id: 'game-id', state, rev: state.rev }, error: null };
    return { select: () => ({ eq: () => ({ ...result, maybeSingle: async () => result, single: async () => ({ data: { rev: state.rev + 9 }, error: null }) }) }) };
  });
});
const commits = () => mocks.commit.mock.calls.map(([name, args]) => ({ name, ...args }));

describe('automatic meld at a leisurely table', () => {
  it('lays down and confirms the meld for every away player who keeps automatic meld on', async () => {
    const result = await botTick('ABC234');
    expect(result.acted).toBe(true);
    const made = commits();
    expect(made.every(c => c.name === 'commit_game_action')).toBe(true);
    // Seat 2 picks meld by hand, so nothing is made for it.
    expect(made.map(c => c.p_action.seat)).not.toContain(2);
    for (const seat of [0, 1, 3] as SeatIndex[]) {
      const own = made.filter(c => c.p_action.seat === seat);
      expect(own.at(-1)).toMatchObject({ p_user: HUMANS[seat], p_action: { type: 'confirm_meld', seat } });
      const cards = autoMeldSelection(state.players[seat].hand, state.trump!);
      if (cards.length) expect(own[0]).toMatchObject({ p_action: { type: 'declare_meld', seat, cards }, p_request_id: `auto-meld:game-id:${state.handNumber}:${seat}:declare_meld` });
      else expect(own).toHaveLength(1);
    }
    // Revisions chain one after another, each broadcast.
    expect(made.map(c => c.p_old_rev)).toEqual(made.map((_, i) => state.rev + i));
    expect(mocks.broadcast).toHaveBeenCalledTimes(made.length);
  });

  it('still melds bots by their own path alongside the humans', async () => {
    seats[1] = { seat: 1, user_id: null, bot: 'Otto' };
    await botTick('ABC234');
    expect(commits().filter(c => c.name === 'commit_bot_action').map(c => c.p_action.seat)).toEqual([1, 1]);
  });

  it('leaves a live table to the players\' own browsers', async () => {
    mocks.pace = 'live';
    await expect(botTick('ABC234')).resolves.toMatchObject({ acted: false });
    expect(mocks.commit).not.toHaveBeenCalled();
  });

  it('melds no one when the preferences cannot be read', async () => {
    prefs = { data: null, error: { message: 'column "auto_meld" does not exist' } };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(botTick('ABC234')).resolves.toMatchObject({ acted: false });
    expect(mocks.commit).not.toHaveBeenCalled();
  });

  it('confirms only for a player who already laid meld down', async () => {
    state.players[0].meld = [{ name: 'run', points: 150, cards: [] } as never];
    await botTick('ABC234');
    expect(commits().filter(c => c.p_action.seat === 0).map(c => c.p_action.type)).toEqual(['confirm_meld']);
  });

  it('picks up a pass that was cut short, melding only who still owes it', async () => {
    // An earlier pass confirmed seats 0 and 1, then a pause or failed commit stopped it; a later tick finishes.
    state.players[0].meldConfirmed = true; state.players[1].meldConfirmed = true;
    await botTick('ABC234');
    expect([...new Set(commits().map(c => c.p_action.seat))]).toEqual([3]);
    expect(commits().at(-1)).toMatchObject({ p_action: { type: 'confirm_meld', seat: 3 } });
  });

  it('stops quietly when the player left the seat or another worker got there first', async () => {
    mocks.commit.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'Action seat does not belong to you' } });
    await expect(botTick('ABC234')).resolves.toEqual({ acted: false, rev: state.rev + 9 });
    mocks.commit.mockResolvedValueOnce({ data: null, error: null });
    await expect(botTick('ABC234')).resolves.toEqual({ acted: false, rev: state.rev + 9 });
    expect(mocks.broadcast).not.toHaveBeenCalled();
  });

  it('melds right after a bot\'s move opens meld, without waiting for another tick', async () => {
    const opening = buildScenario({ dealer: 3, bidder: 1, bid: 25, rules: resolveRules({ passCount: 0, pace: 'leisurely' }), to: 'declaring_trump' }).state;
    seats[1] = { seat: 1, user_id: null, bot: 'Otto' };
    state = opening;
    // The second read (the meld pass) sees the game the bot's commit wrote.
    mocks.commit.mockImplementation(async (_name: string, args: { p_state: GameState }) => { state = args.p_state; return { data: args.p_state.rev, error: null }; });
    await botTick('ABC234');
    const made = commits();
    expect(made[0]).toMatchObject({ name: 'commit_bot_action', p_action: { type: 'declare_trump', seat: 1 } });
    expect(made.filter(c => c.name === 'commit_game_action' && c.p_action.type === 'confirm_meld').map(c => c.p_action.seat)).toEqual([0, 3]);
  });
});
