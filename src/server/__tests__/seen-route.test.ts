import { beforeEach, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/tables/[code]/seen/route';
import { ApiError } from '@/server/errors';
const mocks = vi.hoisted(() => ({ seen: vi.fn(), user: vi.fn() }));
vi.mock('@/server/visits', () => ({ markTableSeen: mocks.seen }));
vi.mock('@/server/bans', () => ({ isBanned: async () => false }));
vi.mock('@/lib/supabase/server', () => ({ createClient: () => ({ auth: { getUser: mocks.user } }) }));
const context = { params: Promise.resolve({ code: 'BCDFGH' }) };
const request = (value: unknown) => new Request('http://localhost/api/tables/BCDFGH/seen', { method: 'POST', body: JSON.stringify(value) });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.mockResolvedValue({ data: { user: { id: 'human' } }, error: null });
});
it('returns the saved revision and keeps responses private', async () => {
  mocks.seen.mockResolvedValue({ lastSeenRev: 12 });
  const response = await POST(request({ rev: 12 }), context);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ lastSeenRev: 12 });
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(mocks.seen).toHaveBeenCalledWith('BCDFGH', 'human', 12, undefined);
});
it.each([true, false])('passes on the automatic meld choice (%s)', async autoMeld => {
  mocks.seen.mockResolvedValue({ lastSeenRev: 3 });
  expect((await POST(request({ rev: 3, autoMeld }), context)).status).toBe(200);
  expect(mocks.seen).toHaveBeenCalledWith('BCDFGH', 'human', 3, autoMeld);
});
it.each([{}, { rev: -1 }, { rev: 1.5 }, { rev: '12' }, { rev: 2147483648 }, { rev: 1, userId: 'other' }, { rev: 1, autoMeld: 'yes' }])('rejects invalid body %j', async input => {
  expect((await POST(request(input), context)).status).toBe(400);
  expect(mocks.seen).not.toHaveBeenCalled();
});
it('requires authentication', async () => {
  mocks.user.mockResolvedValue({ data: { user: null }, error: null });
  expect((await POST(request({ rev: 0 }), context)).status).toBe(401);
  expect(mocks.seen).not.toHaveBeenCalled();
});
it.each([403, 404, 400])('preserves membership, missing table and future revision errors (%s)', async status => {
  mocks.seen.mockRejectedValue(new ApiError(status, 'Rejected'));
  expect((await POST(request({ rev: 1 }), context)).status).toBe(status);
});
it('rejects malformed JSON', async () => {
  expect((await POST(new Request('http://localhost', { method: 'POST', body: '{' }), context)).status).toBe(400);
  expect(mocks.seen).not.toHaveBeenCalled();
});
