// End-to-end smoke test: four disposable confirmed users sit down, trade seats, and play a full hand through the HTTP API.
// Usage: node scripts/smoke.mjs http://localhost:3111   (reads Supabase public keys and SUPABASE_SERVICE_ROLE_KEY from .env.local)
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const base = process.argv[2] ?? "http://localhost:3111";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => l.split("=", 2)));
const names = ["Ada", "Bram", "Cleo", "Dov"];
// The service key stays local. Only each player's access token reaches the app.
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const runId = crypto.randomUUID();
const userIds = [];
const players = [];

function apiForToken(token) {
  return async (path, init = {}) => {
    const res = await fetch(base + path, { ...init, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(init.headers ?? {}) }, body: init.body ? JSON.stringify(init.body) : undefined });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} -> ${res.status} ${json.error ?? ""}`);
    return json;
  };
}

async function player(name, index) {
  const email = `smoke+${runId}-${index}@example.invalid`;
  // create_profile copies full_name into profiles.display_name.
  const created = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { full_name: name } });
  if (created.error) throw created.error;
  userIds.push(created.data.user.id); // Track before any later operation can fail.
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error) throw link.error;
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await sb.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: "magiclink" });
  if (error) throw error;
  const api = apiForToken(data.session.access_token);
  const me = await api("/api/me");
  if (me.id !== created.data.user.id || me.display_name !== name) throw new Error("smoke profile does not match player");
  return { name, id: me.id, api };
}

const t0 = Date.now();
try {
  // Sequential setup means no pending user creations can outlive cleanup on failure.
  for (const [index, name] of names.entries()) players.push(await player(name, index));
  await runSmoke();
} finally {
  await cleanup();
}
console.log("smoke passed");

async function runSmoke() {
  console.log("players:", players.map((p) => `${p.name}=${p.id.slice(0, 8)}`).join(" "));

  const rules = { scoring: "classic", counting: "classic", shoot: "points", shootPoints: 500, revealHands: true };
  const { code } = await players[0].api("/api/tables", { method: "POST", body: { gameKind: "pinochle", rules: {} } });
  await players[0].api(`/api/tables/${code}`, { method: "PATCH", body: { rules } });
  await players[1].api(`/api/tables/${code}`, { method: "PATCH", body: { rules } }).then(() => { throw new Error("non-host changed rules"); }, () => {});
  await players[0].api("/api/me", { method: "PATCH", body: { defaultRules: rules } });
  const me0 = await players[0].api("/api/me");
  if (me0.default_rules?.counting !== "classic") throw new Error("default rules not saved");
  console.log("table", code);
  for (const [i, p] of players.entries()) await p.api(`/api/tables/${code}/seat`, { method: "POST", body: { seat: i } });

  // Seat trade: Bram (1) offers to swap with Dov (3); Dov accepts.
  await players[1].api(`/api/tables/${code}/trade`, { method: "POST", body: { toUserId: players[3].id } });
  let snap = await players[3].api(`/api/tables/${code}`);
  const offer = snap.offers.find((o) => o.to_user === players[3].id);
  await players[3].api(`/api/trades/${offer.id}`, { method: "POST", body: { accept: true } });
  snap = await players[0].api(`/api/tables/${code}`);
  const seatOf = Object.fromEntries(snap.seats.filter((s) => s.user_id).map((s) => [s.user_id, s.seat]));
  console.log("seats after swap:", players.map((p) => `${p.name}:${seatOf[p.id]}`).join(" "));
  if (seatOf[players[1].id] !== 3 || seatOf[players[3].id] !== 1) throw new Error("seat swap did not happen");

  // Non-host cannot start; host can.
  await players[1].api(`/api/tables/${code}/start`, { method: "POST", body: {} }).then(() => { throw new Error("non-host started game"); }, () => {});
  await players[0].api(`/api/tables/${code}/start`, { method: "POST", body: {} });

  const bySeat = (seat) => players.find((p) => seatOf[p.id] === seat);
  const act = async (seat, action) => {
    const current = await bySeat(seat).api(`/api/tables/${code}/view`);
    return bySeat(seat).api(`/api/tables/${code}/act`, { method: "POST", body: { action: { ...action, seat }, expectedRev: current.rev, requestId: crypto.randomUUID() } });
  };
  let view = await bySeat(0).api(`/api/tables/${code}/view`);
  if (view.hand.length !== 12) throw new Error("expected 12 cards");
  // Cheating check: another seat's view must not expose my hand.
  const other = await bySeat(1).api(`/api/tables/${code}/view`);
  if (other.hand.some((c) => view.hand.includes(c))) throw new Error("hands overlap between seats");

  await players[0].api(`/api/tables/${code}/pause`, { method: "POST", body: { reason: "Smoke test" } });
  await expectStatus(bySeat(view.turn), `/api/tables/${code}/act`, { method: "POST", body: { action: { type: "pass_bid", seat: view.turn }, expectedRev: view.rev, requestId: crypto.randomUUID() } }, 409);
  await players[0].api(`/api/tables/${code}/resume`, { method: "POST" });
  const resumed = await bySeat(view.turn).api(`/api/tables/${code}/view`);
  view = await act(view.turn, { type: "bid", amount: resumed.legal.minBid });
  console.log("pause: act 409, resume: act ok");

  let steps = 0;
  while (view.phase !== "hand_over" && view.phase !== "game_over" && steps++ < 400) {
    const seat = view.turn;
    if (view.phase === "melding") {
      for (let s = 0; s < 4; s++) if (!view.meldConfirmed[s]) { const v = await bySeat(s).api(`/api/tables/${code}/view`); if (v.legal.canDeclareMeld) await act(s, { type: "declare_meld", cards: v.hand }); await act(s, { type: "confirm_meld" }); }
    } else {
      const v = await bySeat(seat).api(`/api/tables/${code}/view`);
      const L = v.legal;
      if (L.canShoot && seat === 1 && v.bids.length === 0) view = await act(seat, { type: "shoot" });
      else if (L.canBid && v.bids.length === 0) view = await act(seat, { type: "bid", amount: L.minBid });
      else if (L.canPassBid) view = await act(seat, { type: "pass_bid" });
      else if (L.canDeclineShoot) view = await act(seat, { type: "decline_shoot" });
      else if (L.canDeclareTrump) view = await act(seat, { type: "declare_trump", suit: "H" });
      else if (L.mustPassCount) view = await act(seat, { type: "pass_cards", cards: v.hand.slice(0, L.mustPassCount) });
      else if (L.playableCards.length) view = await act(seat, { type: "play_card", card: L.playableCards[0] });
      else throw new Error(`stuck in ${v.phase} at seat ${seat}`);
      continue;
    }
    view = await bySeat(0).api(`/api/tables/${code}/view`);
  }
  if (view.revealed === null) throw new Error("hands not revealed at hand_over");
  if (view.revealed.atPlay[2].length !== 12 || view.revealed.dealt[3].length !== 12) throw new Error("revealed hands incomplete");
  const h = view.history.at(-1);
  console.log("rules applied:", view.rules.counting, view.rules.shoot, "shot:", h.shotMade);
  console.log(`hand over in ${steps} steps: bid ${h.bid} by seat ${h.bidder}, trump ${h.trump}, meld`, h.meld, "tricks", h.tricks, "delta", h.delta, h.wentSet ? "(set)" : "");
  console.log("score", view.score, `in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  // These confirmed email users have saved-account privileges. Guest-only bot
  // denials are covered by server tests, rather than asserted with saved sessions.
  // A short game exercises rematch through HTTP without waiting for a full match.
  const short = await players[0].api("/api/tables", { method: "POST", body: { gameKind: "pinochle", rules: {} } });
  const shortPath = `/api/tables/${short.code}`;
  await players[0].api(shortPath, { method: "PATCH", body: { rules: { target: 300, shoot: "game" } } });
  for (const [seat, player] of players.entries()) await player.api(`${shortPath}/seat`, { method: "POST", body: { seat } });
  await players[0].api(`${shortPath}/start`, { method: "POST" });
  await expectStatus(players[1], `${shortPath}/rematch`, { method: "POST" }, 403);
  await expectStatus(players[0], `${shortPath}/rematch`, { method: "POST" }, 409);
  let shortView = await driveShortGame(shortPath);
  const finalDealer = shortView.dealer;
  const before = await players[0].api(shortPath);
  await players[0].api(`${shortPath}/rematch`, { method: "POST" });
  const after = await players[0].api(shortPath);
  shortView = await players[0].api(`${shortPath}/view`);
  if (after.table.current_game_id === before.table.current_game_id) throw new Error("rematch reused the old game");
  if (after.table.status !== "playing" || shortView.rev !== 0 || shortView.dealer !== (finalDealer + 1) % 4 || shortView.rules.target !== 300) throw new Error("rematch did not reset the game with rotated dealer and current rules");
  if (JSON.stringify(after.seats) !== JSON.stringify(before.seats)) throw new Error("rematch changed seats");
  console.log("rematch: fresh game, rotated dealer, same seats, target 300");

  // The next player leaves during bidding; a fresh tick must see the new bot.
  const leavingSeat = shortView.turn;
  if (leavingSeat === 0) throw new Error("expected a non-host turn after rematch");
  const left = await players[leavingSeat].api(`${shortPath}/seat`, { method: "DELETE" });
  if (left.mySeat !== null || left.seats[leavingSeat].user_id !== null || !left.seats[leavingSeat].bot) throw new Error("departing player was not replaced by a bot");
  await expectStatus(players[leavingSeat], `${shortPath}/view`, {}, 403);
  await expectStatus(players[leavingSeat], `${shortPath}/act`, { method: "POST", body: { action: { type: "pass_bid", seat: leavingSeat }, expectedRev: shortView.rev, requestId: crypto.randomUUID() } }, 403);
  const tick = await players[0].api(`${shortPath}/tick`, { method: "POST" });
  if (!tick.acted || tick.rev <= shortView.rev) throw new Error("bot tick did not pick up the departed chair");
  const continued = await players[0].api(`${shortPath}/view`);
  const humanAction = await players[continued.turn].api(`${shortPath}/act`, { method: "POST", body: { action: { type: "pass_bid", seat: continued.turn }, expectedRev: continued.rev, requestId: crypto.randomUUID() } });
  if (humanAction.rev <= tick.rev) throw new Error("human action did not use the rematched game");
  console.log("player departure: chair became a bot, lost view/action access, tick advanced");

  // The service client checks retained history without exposing the key to HTTP routes.
  const history = await admin.from("games").select("id,state").eq("table_id", before.table.id);
  if (history.error) throw history.error;
  if (history.data.length !== 2 || history.data.find(g => g.id === before.table.current_game_id)?.state.phase !== "game_over") throw new Error("rematch did not preserve the finished game");
  const staleBot = await admin.rpc("commit_bot_action", { p_game: before.table.current_game_id, p_old_rev: 0, p_state: {}, p_action: { seat: leavingSeat } });
  if (staleBot.error || staleBot.data !== null) throw new Error("database accepted a tick on the historical game");
  // Reuse the confirmed host, so all auth follows the same CAPTCHA-compatible path.
  const host = players[0];
  const savedTable = await host.api("/api/tables", { method: "POST", body: { gameKind: "pinochle", rules: {} } });
  const path = `/api/tables/${savedTable.code}`;
  await host.api(`${path}/seat`, { method: "POST", body: { seat: 0 } });
  for (let seat = 1; seat < 4; seat++) await players[seat].api(`${path}/seat`, { method: "POST", body: { seat } });
  await host.api(`${path}/start`, { method: "POST" });
  await expectStatus(players[1], `${path}/standin`, { method: "POST", body: { seat: 2 } }, 403);
  // Also exercise the database host check directly.
  const denied = await admin.rpc("stand_in", { p_table: savedTable.id, p_user: players[1].id, p_seat: 2 });
  if (denied.error?.code !== "42501") throw new Error("database allowed non-host stand-in");
  for (let seat = 1; seat < 4; seat++) {
    const replaced = await host.api(`${path}/standin`, { method: "POST", body: { seat } });
    if (replaced.seats[seat].user_id !== null || !replaced.seats[seat].bot || replaced.table.status !== "playing") throw new Error("host stand-in failed");
  }
  const withBots = await host.api(path);
  const botView = await host.api(`${path}/view`);
  // Finish by removing the last human, then rematch must refuse an all-bot game.
  const finished = await host.api(`${path}/standin`, { method: "POST", body: { seat: 0 } });
  if (finished.table.status !== "finished" || finished.seats.some(s => s.user_id) || new Set(finished.seats.map(s => s.bot)).size !== 4) throw new Error("last-human stand-in did not finish the table with distinct bots");
  await expectStatus(host, `${path}/rematch`, { method: "POST" }, 400);
  // Restore only this disposable test chair and verify rematch retains bot names.
  const restore = await admin.from("seats").update({ user_id: host.id, bot: null }).eq("table_id", savedTable.id).eq("seat", 0);
  if (restore.error) throw restore.error;
  await host.api(`${path}/rematch`, { method: "POST" });
  const rematchedBots = await host.api(path);
  if (JSON.stringify(rematchedBots.seats) !== JSON.stringify(withBots.seats)) throw new Error("rematch changed bot seats");
  const newView = await host.api(`${path}/view`);
  if (newView.dealer !== (botView.dealer + 1) % 4) throw new Error("abandoned-game rematch dealer did not rotate");
  const abandoned = await host.api(`${path}/seat`, { method: "DELETE" });
  if (abandoned.table.status !== "finished") throw new Error("last-human departure did not finish the table");
  console.log("saved host stand-ins: humans replaced, bot names unique, last human finishes table; rematch retains bots");
}

async function cleanup() {
  if (!userIds.length) return;
  const errors = [];
  const attempt = async (label, operation) => {
    try {
      const result = await operation();
      if (result.error) throw result.error;
      return result.data;
    } catch (error) {
      errors.push(new Error(`cleanup ${label}: ${error.message}`));
      return null;
    }
  };
  // Host/seat profile FKs do not cascade from users. Delete tables first; their
  // games, actions, results, seats, trades, visits and push logs cascade.
  // Query by host to include a table even if its HTTP creation response was lost.
  const tables = await attempt("tables", () => admin.from("tables").delete().in("host", userIds).select("id"));
  const rateKeys = userIds.flatMap(id => ["tables", "actions", "profile", "friends"].map(prefix => `${prefix}:${id}`));
  rateKeys.push(...(tables ?? []).map(table => `ticks:${table.id}`));
  await attempt("rate limits", () => admin.from("rate_limits").delete().in("key", rateKeys));
  // Attempt every user deletion even if an earlier cleanup step failed.
  for (const id of userIds) await attempt("user", () => admin.auth.admin.deleteUser(id));
  if (errors.length) throw new AggregateError(errors, "Smoke cleanup failed");
  console.log(`cleanup: deleted ${userIds.length} users and ${tables.length} tables with dependent rows and rate limits`);
}

async function expectStatus(player, path, init, status) {
  try { await player.api(path, init); }
  catch (error) { if (error.message.includes(` -> ${status} `)) return; throw error; }
  throw new Error(`${path} should have returned ${status}`);
}

async function driveShortGame(path) {
  let view = await players[0].api(`${path}/view`);
  const submit = async (seat, action) => {
    const current = await players[seat].api(`${path}/view`);
    return players[seat].api(`${path}/act`, { method: "POST", body: { action: { ...action, seat }, expectedRev: current.rev, requestId: crypto.randomUUID() } });
  };
  for (let step = 0; step < 400 && view.phase !== "game_over"; step++) {
    if (view.phase === "melding") {
      for (let seat = 0; seat < 4; seat++) {
        const own = await players[seat].api(`${path}/view`);
        if (own.legal.canDeclareMeld) await submit(seat, { type: "declare_meld", cards: own.hand });
        if (own.legal.canConfirmMeld) await submit(seat, { type: "confirm_meld" });
      }
    } else if (view.phase === "hand_over") {
      await submit(0, { type: "next_hand" });
    } else {
      const seat = view.turn;
      const own = await players[seat].api(`${path}/view`);
      const legal = own.legal;
      if (legal.canShoot) await submit(seat, { type: "shoot" });
      else if (legal.canPassBid) await submit(seat, { type: "pass_bid" });
      else if (legal.canDeclareTrump) await submit(seat, { type: "declare_trump", suit: "H" });
      else if (legal.mustPassCount) await submit(seat, { type: "pass_cards", cards: own.hand.slice(0, legal.mustPassCount) });
      else if (legal.playableCards.length) await submit(seat, { type: "play_card", card: legal.playableCards[0] });
      else throw new Error(`short game stuck in ${own.phase}`);
    }
    view = await players[0].api(`${path}/view`);
  }
  if (view.phase !== "game_over") throw new Error("short game did not finish");
  return view;
}
