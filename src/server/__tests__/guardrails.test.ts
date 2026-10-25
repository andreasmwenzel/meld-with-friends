import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, mergeSettings, settingsPatchSchema } from '@/lib/settings';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), requireUser: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ rpc: mocks.rpc, from: mocks.from }) }));
vi.mock('@/server/http', async importOriginal => ({ ...await importOriginal<typeof import('@/server/http')>(), requireUser: mocks.requireUser }));
import { enforce } from '../limits';
import { isAdmin, requireAdmin } from '../admin';
import { emptyMetrics } from '../metrics';
import { getSettings, updateSettings, getUsageStats } from '../settings';
import { POST as addBot } from '@/app/api/tables/[code]/bots/route';
import { POST as fillBots } from '@/app/api/tables/[code]/bots/fill/route';
import { GET as adminGet, PATCH as adminPatch } from '@/app/api/admin/settings/route';
import { GET as adminStats } from '@/app/api/admin/stats/route';
import { POST as adminArena } from '@/app/api/admin/arena/route';

beforeEach(() => { vi.clearAllMocks(); vi.stubEnv('ADMIN_EMAILS', ' Boss@Example.com,other@example.com '); });
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
const context = { params: Promise.resolve({ code: 'ABC234' }) };
const req = (body = {}) => new Request('http://localhost/api', { method: 'POST', body: JSON.stringify(body) });

describe('quota enforcement', () => {
  it('allows N requests then throws 429, passing the database window parameters', async () => {
    let count = 0;
    mocks.rpc.mockImplementation(async () => ({ data: ++count <= 10, error: null }));
    for (let i = 0; i < 10; i++) await enforce('tables:user', 10, 3600);
    await expect(enforce('tables:user', 10, 3600)).rejects.toMatchObject({ status: 429, message: expect.stringContaining('Slow down:') });
    expect(mocks.rpc).toHaveBeenLastCalledWith('consume_rate', { p_key: 'tables:user', p_limit: 10, p_window_seconds: 3600 });
  });
  it('fails closed on a database error', async () => {
    mocks.rpc.mockResolvedValue({ error: { code: '42501', message: 'denied' }, data: null });
    await expect(enforce('actions:u', 600, 3600)).rejects.toMatchObject({ status: 403 });
  });
});
describe('admin and saved-account gates', () => {
  it('matches emails case-insensitively and rejects missing or unlisted emails', () => {
    expect(isAdmin({ email: 'boss@example.COM' })).toBe(true);
    expect(isAdmin({})).toBe(false);
    expect(isAdmin({ email: 'intruder@example.com' })).toBe(false);
  });
  it('allows a saved admin', async () => {
    const session = { user: { email: 'boss@example.com', is_anonymous: false } };
    mocks.requireUser.mockResolvedValue(session);
    await expect(requireAdmin()).resolves.toEqual(session);
  });
  it('returns 403 on every admin route for non-admins', async () => {
    mocks.requireUser.mockResolvedValue({ user: { email: 'intruder@example.com' } });
    for (const response of [await adminGet(), await adminPatch(req()), await adminStats(), await adminArena(req({ games: 1 }))]) expect(response.status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('rejects anonymous users even with a matching admin email', async () => {
    mocks.requireUser.mockResolvedValue({ user: { email: 'boss@example.com', is_anonymous: true } });
    await expect(requireAdmin()).rejects.toMatchObject({ status: 403 });
  });
  it('rejects guests adding or filling bots before table access', async () => {
    mocks.requireUser.mockResolvedValue({ user: { id: 'guest', is_anonymous: true } });
    for (const handler of [addBot, fillBots]) {
      const response = await handler(req({ seat: 1 }), context);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: 'Computer players need a saved account' });
    }
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
describe('settings persistence', () => {
  it('deep-merges partial settings and rejects invalid patches', () => {
    expect(mergeSettings({ bots: { samples: 2 }, limits: { tablesPerHour: 5 } })).toEqual({ bots: { ...DEFAULT_SETTINGS.bots, samples: 2 }, limits: { ...DEFAULT_SETTINGS.limits, tablesPerHour: 5 } });
    expect(mergeSettings(null)).toEqual(DEFAULT_SETTINGS);
    for (const patch of [{ bots: { samples: 0 } }, { limits: { tablesPerHour: -1 } }, { unknown: true }, { bots: { typo: 1 } }]) expect(settingsPatchSchema.safeParse(patch).success).toBe(false);
  });
  it('caches for 30 seconds, validates before saving, and invalidates on patch', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2030-01-01'));
    let stored = { bots: { samples: 3, bidMargin: 10 }, limits: { tablesPerHour: 7 } };
    mocks.from.mockImplementation(() => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { value: stored }, error: null }) }) }) }));
    mocks.rpc.mockImplementation(async (_name, { p_patch }) => {
      stored = { bots: { ...stored.bots, ...p_patch.bots }, limits: { ...stored.limits, ...p_patch.limits } };
      return { data: stored, error: null };
    });
    expect((await getSettings()).bots.samples).toBe(3);
    const copy = await getSettings(); copy.bots.samples = 999;
    expect((await getSettings()).bots.samples).toBe(3);
    expect(mocks.from).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30_001); await getSettings();
    expect(mocks.from).toHaveBeenCalledTimes(2);
    await expect(updateSettings({ bots: { samples: 0 } })).rejects.toThrow();
    expect(mocks.rpc).not.toHaveBeenCalled();
    const updated = await updateSettings({ bots: { samples: 5 } });
    expect(updated.bots).toMatchObject({ samples: 5, bidMargin: 10 });
    expect(updated.limits.tablesPerHour).toBe(7);
    await getSettings(); expect(mocks.from).toHaveBeenCalledTimes(3);
  });
  it('uses count-only usage queries and UTC day boundaries', async () => {
    const chain = { select: vi.fn().mockReturnThis(), gte: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), then: (resolve: (v: unknown) => void) => resolve({ count: 4, error: null }) };
    vi.useFakeTimers(); vi.setSystemTime(new Date('2030-01-01T12:00:00Z'));
    const lastCleanup = { at: '2029-12-31T09:00:00Z', summary: { tablesDeleted: 3 } };
    mocks.from.mockImplementation((table: string) => {
      if (table === 'metrics') return { select: () => ({ gte: () => ({ lte: async () => ({ data: [
        { day: '2030-01-01', key: 'act', count: '17' },
        { day: '2029-12-31', key: 'tick_noop', count: 9 },
      ], error: null }) }) }) };
      if (table === 'app_settings') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { value: lastCleanup }, error: null }) }) }) };
      return chain;
    });
    mocks.rpc.mockResolvedValue({ data: 2, error: null });
    expect(await getUsageStats()).toEqual({ tablesToday: 4, actionsToday: 4, ticksToday: 4, openTables: 4, playingTables: 4, profiles: 4, guests: 2, gamesStored: 4, actionsStored: 4, today: { ...emptyMetrics(), act: 17 }, yesterday: { ...emptyMetrics(), tick_noop: 9 }, lastCleanup });
    expect(chain.select).toHaveBeenCalledWith('id', { count: 'exact', head: true });
    expect(chain.eq).toHaveBeenCalledWith('by_bot', true);
    expect(chain.gte.mock.calls[0][1]).toBe('2030-01-01T00:00:00.000Z');
    mocks.from.mockImplementation((table: string) => {
      if (table === 'metrics') return { select: () => ({ gte: () => ({ lte: async () => ({ data: [], error: null }) }) }) };
      if (table === 'app_settings') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) };
      return chain;
    });
    expect(await getUsageStats()).toMatchObject({ today: emptyMetrics(), yesterday: emptyMetrics(), lastCleanup: null });
  });
});
