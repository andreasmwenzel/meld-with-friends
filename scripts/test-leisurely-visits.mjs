// Disposable integration fixtures; large cleanup thresholds leave application tables alone.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split('\n').filter(l => l.includes('=')).map(l => l.split('=', 2)));
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ok = async promise => { const { data, error } = await promise; if (error) throw error; return data; };
const fails = async (promise, code) => { const { error } = await promise; assert.equal(error?.code, code, JSON.stringify(error)); };
const users = [], tables = [];
const seen = (table, user, rev) => db.rpc('mark_table_seen', { p_table: table, p_user: user, p_rev: rev });
try {
  const password = crypto.randomUUID();
  const email = `meld-visits-${crypto.randomUUID()}@example.com`;
  for (const address of [email, `meld-outsider-${crypto.randomUUID()}@example.com`]) {
    const data = await ok(db.auth.admin.createUser({ email: address, password, email_confirm: true }));
    users.push(data.user.id);
  }
  const [host, outsider] = users;
  const makeTable = async pace => {
    const alphabet = 'BCDFGHJKMNPQRSTVWXYZ23456789';
    const code = Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
    const table = await ok(db.rpc('create_table', { p_code: code, p_user: host, p_kind: 'pinochle', p_rules: { pace } }));
    tables.push(table.id); return table.id;
  };
  const table = await makeTable('leisurely');
  await ok(db.rpc('take_seat', { table_id: table, seat: 0, user_id: host }));
  assert.equal(await ok(seen(table, host, 0)), 0);
  await fails(seen(table, outsider, 0), '42501');
  await fails(seen(table, host, -1), '22023');
  await fails(seen(table, host, 1), '22023');
  const game = await ok(db.from('games').insert({ table_id: table, game_kind: 'pinochle', state: { rev: 12 }, rev: 12 }).select('id').single());
  await ok(db.from('tables').update({ current_game_id: game.id }).eq('id', table));
  assert.deepEqual(await ok(db.from('table_visits').select('*').eq('table_id', table)), []);
  assert.equal(await ok(seen(table, host, 12)), 12);
  assert.equal(await ok(seen(table, host, 3)), 12);
  const visit = await ok(db.from('table_visits').select('*').eq('table_id', table).single());
  assert.equal(visit.user_id, host); assert.ok(visit.last_seen);
  const human = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  await ok(human.auth.signInWithPassword({ email, password }));
  await fails(human.from('table_visits').select('*'), '42501');
  await fails(human.rpc('mark_table_seen', { p_table: table, p_user: host, p_rev: 0 }), '42501');
  await ok(db.rpc('leave_seat', { p_table: table, p_user: host }));
  await fails(seen(table, host, 1), '42501');
  const live = await makeTable('live'), leisurely = await makeTable('leisurely');
  for (const id of [live, leisurely]) await ok(db.from('tables').update({ created_at: '1900-01-01T00:00:00Z' }).eq('id', id));
  // Live: 100 years; leisurely: 150 years; retention: 100,000 days.
  const cleanup = () => ok(db.rpc('cleanup_tables', { p_idle_hours: 876000, p_leisurely_days: 54750, p_retain_days: 100000 }));
  await cleanup();
  assert.equal((await ok(db.from('tables').select('status').eq('id', live).single())).status, 'finished');
  assert.equal((await ok(db.from('tables').select('status').eq('id', leisurely).single())).status, 'open');
  await ok(db.from('tables').update({ created_at: '1800-01-01T00:00:00Z', paused_by: host, paused_at: new Date().toISOString() }).eq('id', leisurely));
  await cleanup();
  assert.equal((await ok(db.from('tables').select('status').eq('id', leisurely).single())).status, 'finished');
  console.log('Visit authorization, monotonic revisions, game reset, service-only access, and leisurely cleanup passed.');
} finally {
  for (const id of tables) await ok(db.from('tables').delete().eq('id', id));
  for (const id of users) await ok(db.auth.admin.deleteUser(id));
}
