import { beforeEach, describe, expect, it, vi } from 'vitest';
import { newGame } from '@/engine/game';
import type { GameState } from '@/engine/types';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), broadcast: vi.fn(), notify: vi.fn() }));
vi.mock('../push', () => ({ scheduleTurnNotification: mocks.notify }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: mocks.from, rpc: mocks.rpc }) }));
vi.mock('../tables', () => ({ tableByCode: async () => ({ id: 'table-id', code: 'ABC234', current_game_id: 'game-id', status: 'playing' }) }));
vi.mock('../realtime', () => ({ broadcastTable: mocks.broadcast }));
import { botTick } from '../game';

let state: GameState;
let botSeat: number;
beforeEach(() => {
  vi.clearAllMocks();
  state = newGame('tick-regression'); botSeat = 1;
  mocks.from.mockImplementation((name: string) => {
    const result = name === 'seats' ? { data: [{ seat: 0, user_id: 'human', bot: null }, { seat: botSeat, user_id: null, bot: 'Otto' }], error: null } : { data: { id: 'game-id', state, rev: state.rev }, error: null };
    return { select: () => ({ eq: () => ({ ...result, maybeSingle: async () => result, single: async () => ({ data: { rev: 1 }, error: null }) }) }) };
  });
});
describe('paced bot ticks', () => {
  it('returns a stale database compare-and-swap as a no-op without broadcasting', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    await expect(botTick('ABC234')).resolves.toEqual({ acted: false, rev: 1 });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.broadcast).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
  });
  it('persists exactly one bot action and broadcasts its revision', async () => {
    mocks.rpc.mockResolvedValue({ data: 1, error: null });
    await expect(botTick('ABC234')).resolves.toEqual({ acted: true, rev: 1 });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith('commit_bot_action', expect.objectContaining({ p_old_rev: 0, p_action: expect.objectContaining({ seat: 1 }), p_state: expect.objectContaining({ rev: 1 }) }));
    expect(mocks.broadcast).toHaveBeenCalledWith('ABC234', { type: 'game', rev: 1 });
    expect(mocks.notify).toHaveBeenCalledWith('game-id');
  });
  it('reads seats again so a newly replaced human acts on the next tick', async () => {
    state.turn = 2;
    await expect(botTick('ABC234')).resolves.toEqual({ acted: false, rev: 0 });
    botSeat = 2;
    mocks.rpc.mockResolvedValue({ data: 1, error: null });
    await expect(botTick('ABC234')).resolves.toEqual({ acted: true, rev: 1 });
    expect(mocks.rpc).toHaveBeenCalledWith('commit_bot_action', expect.objectContaining({ p_action: expect.objectContaining({ seat: 2 }) }));
  });
  it('leaves human turns and hand advancement to humans', async () => {
    state.turn = 0;
    await expect(botTick('ABC234')).resolves.toEqual({ acted: false, rev: 0 });
    state.phase = 'hand_over'; state.turn = null;
    await expect(botTick('ABC234')).resolves.toEqual({ acted: false, rev: 0 });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

vi.mock('@/server/settings', () => ({ getSettings: async () => (await import('@/lib/settings')).DEFAULT_SETTINGS }));
vi.mock('@/server/limits', () => ({ enforce: async () => {} }));
