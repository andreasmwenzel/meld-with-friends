import { beforeEach, expect, it, vi } from 'vitest';
import { newGame } from '@/engine/game';
import type { GameState } from '@/engine/types';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), broadcast: vi.fn(), enforce: vi.fn(), notify: vi.fn() }));
vi.mock('../push', () => ({ scheduleTurnNotification: mocks.notify }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: mocks.from, rpc: mocks.rpc }) }));
vi.mock('../tables', () => ({ tableByCode: async () => ({ id: 'table', code: 'ABC234', current_game_id: 'game-id', status: 'playing' }) }));
vi.mock('../realtime', () => ({ broadcastTable: mocks.broadcast }));
vi.mock('../settings', () => ({ getSettings: async () => (await import('@/lib/settings')).DEFAULT_SETTINGS }));
vi.mock('../limits', () => ({ enforce: mocks.enforce }));
import { act } from '../game';
let state: GameState;
let duplicate: boolean;
beforeEach(() => {
  for (const [key, value] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: "https://meld.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service-role", CRON_SECRET: "cron" })) vi.stubEnv(key, value);
  vi.clearAllMocks();
  state = newGame('action-ids'); duplicate = false;
  mocks.from.mockImplementation((name: string) => {
    const result = () => ({ data: name === 'seats' ? { seat: 1 } : name === 'game_actions' ? duplicate ? { id: 'audit' } : null : { id: 'game', state, rev: state.rev }, error: null });
    const query = { select: () => query, eq: () => query, maybeSingle: async () => result() };
    return query;
  });
});
const action = { type: 'bid', seat: 1, amount: 250 } as const;
const requestId = 'dbe155e0-5dc8-46f0-a8ef-ae3f017e6af4';
it('rejects a stale expectedRev with the current PlayerView before applying or consuming quota', async () => {
  await expect(act('ABC234', 'human', action, 5, requestId)).rejects.toMatchObject({ status: 409, data: { rev: 0, seat: 1 } });
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(mocks.enforce).not.toHaveBeenCalled();
});
it('returns the current view for a duplicate even when its expectedRev is stale', async () => {
  duplicate = true;
  await expect(act('ABC234', 'human', action, 5, requestId)).resolves.toMatchObject({ rev: 0 });
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it('passes the action identity into the atomic commit', async () => {
  mocks.rpc.mockResolvedValue({ data: 1, error: null });
  await expect(act('ABC234', 'human', action, 0, requestId)).resolves.toMatchObject({ rev: 1 });
  expect(mocks.notify).toHaveBeenCalledWith('game');
  expect(mocks.rpc).toHaveBeenCalledWith('commit_game_action', expect.objectContaining({ p_request_id: requestId, p_old_rev: 0 }));
});
it('returns the current view when the transaction detects a concurrent duplicate', async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: null });
  await expect(act('ABC234', 'human', action, 0, requestId)).resolves.toMatchObject({ rev: 0 });
  expect(mocks.broadcast).not.toHaveBeenCalled();
  expect(mocks.notify).not.toHaveBeenCalled();
});
it.each([
  ['40001', 'changed'],
  ['PT409', 'Game changed; refresh and retry'],
  ['PT409', 'Table is not playing this game'],
])('returns a 409 PlayerView when a competing action wins the database revision guard (%s %s)', async (code, message) => {
  mocks.rpc.mockImplementation(async () => { state.rev = 2; return { error: { code, message } }; });
  await expect(act('ABC234', 'human', action, 0, requestId)).rejects.toMatchObject({ status: 409, data: { rev: 2 } });
  expect(mocks.broadcast).not.toHaveBeenCalled();
  expect(mocks.notify).not.toHaveBeenCalled();
});
it('keeps the message of other PT409 conflicts from the commit', async () => {
  mocks.rpc.mockResolvedValue({ error: { code: 'PT409', message: 'Every human must be ready for the next hand.' } });
  await expect(act('ABC234', 'human', action, 0, requestId))
    .rejects.toMatchObject({ status: 409, message: 'Every human must be ready for the next hand.', data: undefined });
});
