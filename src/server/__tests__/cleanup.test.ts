import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@/lib/settings';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), settings: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ rpc: mocks.rpc, from: mocks.from }) }));
vi.mock('@/server/settings', () => ({ getSettings: mocks.settings }));
vi.mock("@/server/metrics", () => ({ bump: vi.fn() }));
import { bump } from "../metrics";
import { GET } from '@/app/api/cron/keepalive/route';
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test');
  vi.stubEnv('CRON_SECRET', 'secret');
  mocks.settings.mockResolvedValue(DEFAULT_SETTINGS);
  mocks.from.mockReturnValue({ delete: () => ({ lt: async () => ({ error: null }) }), upsert: async () => ({ error: null }) });
});
afterEach(() => vi.unstubAllEnvs());
it('rejects cleanup without the cron secret before accessing data', async () => {
  expect((await GET(new Request('http://localhost/api/cron/keepalive'))).status).toBe(401);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it('passes saved retention settings to SQL and reports cleanup counts', async () => {
  mocks.rpc.mockResolvedValueOnce({ data: { tablesFinished: 2, tablesDeleted: 1, rateLimitsDeleted: 8 }, error: null })
    .mockResolvedValueOnce({ data: 3, error: null });
  const response = await GET(new Request('http://localhost/api/cron/keepalive', { headers: { authorization: 'Bearer secret' } }));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true, tablesFinished: 2, tablesDeleted: 1, rateLimitsDeleted: 8, guestsDeleted: 3 });
  expect(mocks.from).toHaveBeenCalledWith("metrics");
  expect(mocks.from).toHaveBeenCalledWith("app_settings");
  expect(bump).toHaveBeenCalledWith("cleanup_run");
  expect(bump).toHaveBeenCalledWith("cleanup_finished_tables", 2);
  expect(bump).toHaveBeenCalledWith("cleanup_deleted_tables", 1);
  expect(bump).toHaveBeenCalledWith("cleanup_pruned_guests", 3);
  expect(mocks.rpc.mock.calls).toEqual([
    ['cleanup_tables', { p_idle_hours: 48, p_leisurely_days: 60, p_retain_days: 30 }], ['prune_guests', { p_days: 30 }],
  ]);
});
