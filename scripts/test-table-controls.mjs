// Database integration checks. Uses disposable users/tables; requires the pushed migration.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter(l => l.includes("=")).map(l => l.split("=", 2)));
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const users = [], tables = [];
const ok = async promise => { const { data, error } = await promise; if (error) throw error; return data; };
const fails = async (promise, code, message) => { const { error } = await promise; assert.equal(error?.code, code, JSON.stringify(error)); if (message) assert.equal(error.message, message); };
const control = (table, user, operation, value = null) => db.rpc("control_table", { p_table: table, p_user: user, p_operation: operation, p_value: value });
try {
  for (let i = 0; i < 3; i++) {
    const data = await ok(db.auth.admin.createUser({ email: `meld-controls-${crypto.randomUUID()}@example.com`, password: crypto.randomUUID(), email_confirm: true }));
    users.push(data.user.id);
  }
  const guest = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const guestData = await ok(guest.auth.signInAnonymously()); users.push(guestData.user.id);
  const [host, saved, outsider, anonymous] = users;
  const makeTable = async () => {
    const alphabet = "BCDFGHJKMNPQRSTVWXYZ23456789";
    const code = Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
    const t = await ok(db.rpc("create_table", { p_code: code, p_user: host, p_kind: "pinochle", p_rules: {} }));
    tables.push(t.id); return t.id;
  };
  console.log("Created disposable test users.");
  const t = await makeTable();
  for (const [seat, user] of [[0, host], [1, anonymous], [2, saved]]) await ok(db.rpc("take_seat", { table_id: t, seat, user_id: user }));
  await fails(control(t, outsider, "pause"), "42501");
  await fails(control(t, host, "host", anonymous), "22023");
  await fails(control(t, host, "host", outsider), "22023");
  await fails(control(t, anonymous, "host", saved), "42501");
  await ok(control(t, host, "host", saved));
  assert.equal((await ok(db.from("tables").select("host").eq("id", t).single())).host, saved);
  await ok(control(t, saved, "host", host));
  await fails(control(t, outsider, "ready"), "42501");
  await fails(control(t, host, "ready"), "PT409");
  console.log("Host validation and ready authorization passed.");
  const state = { phase: "hand_over", rev: 0, dealer: 0 };
  const game = await ok(db.from("games").insert({ table_id: t, game_kind: "pinochle", state, rev: 0 }).select("id").single());
  await ok(db.from("tables").update({ current_game_id: game.id, status: "playing" }).eq("id", t));
  await ok(control(t, anonymous, "ready")); await ok(control(t, anonymous, "ready"));
  assert.deepEqual((await ok(db.from("games").select("ready").eq("id", game.id).single())).ready, [1]);
  const commit = (user, seat, rev) => db.rpc("commit_game_action", { p_game: game.id, p_user: user, p_old_rev: rev, p_state: { ...state, phase: "bidding", rev: rev + 1 }, p_action: { type: "next_hand", seat }, p_request_id: crypto.randomUUID() });
  await fails(commit(anonymous, 1, 0), "PT409", "Every human must be ready for the next hand.");
  await ok(control(t, anonymous, "pause", "Break"));
  await fails(control(t, saved, "resume"), "42501");
  await fails(commit(host, 0, 0), "PT409", "The table is paused.");
  await fails(db.rpc("commit_bot_action", { p_game: game.id, p_old_rev: 0, p_state: { ...state, rev: 1 }, p_action: { type: "pass_bid", seat: 3 } }), "PT409", "The table is paused.");
  await ok(control(t, host, "resume"));
  await ok(commit(host, 0, 0)); // host overrides unready saved seat
  assert.deepEqual((await ok(db.from("games").select("ready").eq("id", game.id).single())).ready, []);
  await ok(db.from("games").update({ state: { ...state, rev: 1 } }).eq("id", game.id));
  for (const user of [host, saved, anonymous]) await ok(control(t, user, "ready"));
  await ok(commit(anonymous, 1, 1));
  await ok(db.rpc("leave_seat", { p_table: t, p_user: host }));
  assert.equal((await ok(db.from("tables").select("host").eq("id", t).single())).host, saved, "saved seat 2 wins over guest seat 1");
  await ok(db.rpc("leave_seat", { p_table: t, p_user: saved }));
  assert.equal((await ok(db.from("tables").select("host").eq("id", t).single())).host, anonymous, "falls back to lowest human guest");
  console.log("Ready, pause, and handoff checks passed.");
  // Use a 100-year idle threshold so cleanup cannot touch normal application tables.
  const idle = await makeTable();
  await ok(db.from("tables").update({ created_at: "1900-01-01T00:00:00Z" }).eq("id", idle));
  await ok(control(idle, host, "pause"));
  await ok(db.rpc("cleanup_tables", { p_idle_hours: 876000, p_retain_days: 100000 }));
  assert.equal((await ok(db.from("tables").select("status").eq("id", idle).single())).status, "open");
  await ok(db.from("tables").update({ paused_at: new Date(Date.now() - 25 * 3600000).toISOString() }).eq("id", idle));
  await ok(db.rpc("cleanup_tables", { p_idle_hours: 876000, p_retain_days: 100000 }));
  assert.equal((await ok(db.from("tables").select("status").eq("id", idle).single())).status, "finished");
  console.log("table controls integration passed: ready gating/reset, pause, cleanup, host validation and automatic handoff");
} finally {
  for (const id of tables) await ok(db.from("tables").delete().eq("id", id));
  for (const id of users) await ok(db.auth.admin.deleteUser(id));
}
