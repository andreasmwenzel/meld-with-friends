import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
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
it('prunes guests by their latest auth activity, not account age', () => {
  // The SQL runs only in Supabase; pin the rule in the newest definition of prune_guests.
  const sql = readFileSync('supabase/migrations/0015_prune_inactive_guests.sql', 'utf8');
  expect(sql).toContain('create or replace function public.prune_guests(p_days int)');
  expect(sql).toContain('greatest(u.created_at,u.last_sign_in_at,u.updated_at)<cutoff');
  expect(sql).toContain('not exists(select 1 from auth.sessions s where s.user_id=u.id and greatest(s.created_at,s.updated_at)>=cutoff)');
  expect(sql).toContain('not exists(select 1 from auth.refresh_tokens r where r.user_id=u.id::text and greatest(r.created_at,r.updated_at)>=cutoff)');
  for (const kept of ['public.seats s where s.user_id=u.id', 'public.tables t where t.host=u.id', 'public.banned_users b where b.user_id=u.id']) {
    expect(sql).toContain(`not exists(select 1 from ${kept})`);
  }
  expect(sql).not.toMatch(/u\.created_at<now\(\)/);
});
