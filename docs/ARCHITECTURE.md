# Meld — architecture

Meld is a Next.js (App Router) site hosted on Vercel Hobby, with Supabase (free tier) for
Postgres, Auth and Realtime. Zero infrastructure cost. First game: 4-hand partnership pinochle.
The engine is game-agnostic at the storage layer (`games.state` is jsonb keyed by `game_kind`).

## Layers

| Layer | Where | Notes |
| --- | --- | --- |
| Rules engine | `src/engine/` | Pure TS, deterministic, no I/O. `applyAction(state, action)` returns new state or throws `IllegalAction`. `viewFor(state, seat)` returns a `PlayerView` with other hands hidden. Unit tested with vitest. |
| Data | `supabase/migrations/*.sql` | Schema + RLS. Hidden information (full `GameState`) is only readable by the service role. Clients never read `games.state` directly. |
| Server | `src/app/api/**/route.ts` and `src/server/` | Route handlers run with the service role after verifying the user's session. They validate, call the engine, write state, then broadcast `{ rev }` on the table's Realtime channel; a move that changes nothing private also carries its public part, signed (see Realtime channels). |
| Client | `src/app/**`, `src/components/**` | `TableRoom` holds the tab's one subscription to the table channel. Seat, trade and control events refetch the table snapshot; seat events (ready checks among them) also make the board refetch its view once; `game` events go to the board, which applies a signed public move for the next revision locally and otherwise refetches its own `PlayerView` from `/api/tables/[code]/view` at most once per event (none for its own move, whose POST response carries the view). Events arriving together share one fetch, and so does the seat event echoing this player's own ready check (see `src/components/table/viewSync.ts`). Presence on a global `lobby` channel gives "friends online / at a table". |

## Data model (Postgres)

- `profiles` (id = auth.users.id, handle unique, display_name, avatar_seed, created_at)
- `friendships` (requester, addressee, status: pending|accepted|blocked, created_at)
- `tables` (id, code char(6) unique — Crockford base32 without vowels, host, game_kind, status: open|playing|finished, rules jsonb, created_at)
- `seats` (table_id, seat int 0..3, user_id null, pk (table_id, seat)) — null user = empty chair
- `seat_trade_offers` (id, table_id, from_user, to_user, from_seat, to_seat, status: pending|accepted|declined|cancelled, created_at)
- `games` (id, table_id, game_kind, state jsonb, rev int, created_at, updated_at) — service role only
- `game_actions` (id, game_id, seat, action jsonb, rev, created_at) — append-only audit log
- `game_results` (game_id primary key, table_id, code, finished_at, score, winner, hands, seats) stores a finish snapshot with seat number, user id, name, and bot flag. Deleting its game cascades to the result.
- `game_result_players` (game_id, user_id, team, won) indexes each seated human, including guests. RLS permits users to read their own index rows and matching results.
- `banned_users` (user_id primary key, reason, created_at) is service-role only. Bans survive guest pruning.

Logical conflicts in SQL functions (a stale revision, a table that changed, a paused table) raise `PT409`, which the database API returns as HTTP 409, or return null as `commit_bot_action` does. They are never raised as `40001`: the API treats that serialization failure as transient and retries the statement until its upstream timeout, so a burst of stale requests holds every pooled connection (migration 0017). `src/server/__tests__/conflict-codes.test.ts` checks the live definition of every function.

## Realtime channels

- `table:{code}` — broadcast events: `seats` (seat map changed), `trade` (offer created/answered), `game` ({ rev, move?, sig? }), `chat`.

The table channel is public to anyone with the code, so a `game` event never carries hidden cards.
`publicMove` (`src/engine/publicMove.ts`) describes a move only when no seat's private view changes
beyond the mover losing the card it played: bids, trump, meld declarations and confirmations, and card
plays within a hand. Deals, passing, the end of a hand and a new game send the bare revision. The
description is the move's public fields plus the view fields it changed, identical for every seat.
The server signs it with an Ed25519 key derived from its service-role secret
(`src/server/moveSigning.ts`), bound to the game id; each view carries the public key (`moveKey`).
A client applies a move only if the signature checks, it names the current game, and its revision is
exactly one past the client's; anything else (a gap, out of order, no Ed25519 in the browser) fetches
`/view`. The acting client takes its own move from the POST response.
- `presence:lobby` — presence keyed by user id with `{ handle, tableCode | null }`.

## Auth

Supabase Auth with magic link email and Google. `profiles` row is created by a trigger on `auth.users` insert.

## Keep-alive

`src/app/api/cron/keepalive/route.ts` runs daily via `vercel.json` cron. Its cleanup queries keep the free Supabase project active; see Free-tier guardrails below for retention and rate-counter pruning.

## Free-tier guardrails

`src/lib/settings.ts` defines defaults and validates admin patches. The service-role-only `app_settings` row with key `global` stores overrides. `src/server/settings.ts` caches merged settings for 30 seconds per process; a successful patch clears that process's cache. Other running instances can retain their old values for up to 30 seconds. Settings patches merge under a database row lock. `ADMIN_EMAILS` is an optional comma-separated, case-insensitive allowlist; an empty list grants no admin access. All `/api/admin/settings`, `/api/admin/stats`, and `/api/admin/arena` handlers require a saved admin session.

| Setting | Default | Enforcement |
| --- | --- | --- |
| `tablesPerHour` | 10 per user | `createTable` before allocation |
| `maxOpenTablesPerHost` | 3 unfinished tables | `createTable` count plus serialized `create_table` database check |
| `actionsPerHour` | 600 per user | `act` before engine application and audit commit |
| `ticksPerTablePerHour` | 2000 per table | Bot worker before database reads and decisions, including automatic melding |
| `friendRequestsPerHour` | 20 per user | `requestFriend` before lookup and insertion |
| `profileEditsPerHour` | 30 per user | `PATCH /api/me` after body validation |
| `replaysPerHour` | 120 per client address | `GET /api/replay/[id]` before any database read |
| `idleTableHours` | 48 hours | Daily cron finishes open or playing tables with no recent game activity |
| `retainFinishedDays` | 30 days | Daily cron deletes finished tables whose last activity predates retention |
| `retainGuestDays` | 30 days | Daily cron deletes anonymous auth users inactive for this long who occupy no seats and host no tables |

`src/server/limits.ts` calls the service-role-only `consume_rate` function. An atomic upsert counts attempts in fixed UTC-aligned hourly windows shared by all function instances. Over-limit requests return 429 with a `Slow down:` message. Failed attempts can consume allowance. Direct authenticated profile edits and friend-request inserts are revoked so callers cannot bypass these API limits. Friend reads, responses, and removal retain their existing policies. Guests receive 403 when adding or filling computer players, enforced in HTTP and SQL.

The existing `0 9 * * *` Vercel schedule calls `/api/cron/keepalive` daily at 09:00 UTC with `CRON_SECRET`. It finishes idle tables, deletes expired finished tables, prunes rate counter windows older than two hours, then prunes unused guests. A guest is pruned only when they sit at no seat, host no table, are not banned, and have been inactive for `retainGuestDays`. Activity is the newest of account creation, last sign-in, the last auth user update, and the newest refresh of any of their Supabase Auth sessions or refresh tokens. An open tab refreshes its session about hourly, so a guest who keeps playing is kept even while between tables, and Meld needs no last-seen column of its own. Table age is the latest of `tables.created_at` and `games.updated_at`, including for finished-table retention. Foreign keys cascade table deletion through games, action logs, seats, and trade offers. Profiles cascade from deleted auth users; historical trade offers also cascade to avoid blocking guest removal. The response reports `tablesFinished`, `tablesDeleted`, `rateLimitsDeleted`, and `guestsDeleted`. Database work also keeps the project active.

Usage counts use UTC midnight for today's tables, actions, and bot actions. `game_actions.by_bot` records bot commits in their transaction, rather than inferring ownership after seats change. Total storage counts and anonymous-user counts are available only through the admin stats route.

Supabase also limits anonymous sign-ins per IP; tune that setting in Authentication > Rate Limits in the dashboard. Magic links share Supabase Auth's built-in email-sending limit, which is separate from Meld's counters. Review the project's email provider and Auth limits before increasing signup traffic. See [Supabase Auth rate limits](https://supabase.com/docs/guides/auth/rate-limits) and [anonymous sign-in abuse prevention](https://supabase.com/docs/guides/auth/auth-anonymous#abuse-prevention-and-rate-limits).


## History and administration

`GET /api/history` requires a session and returns a bare array, newest finish first, capped at 50 entries. Each entry has `gameId`, `code`, `finishedAt`, `score: { red, blue }`, `myTeam`, `won`, `hands`, `partner`, and `opponents: [name, name]`. Seat names come from the finish snapshot. Guests can read their own history. Results follow the existing finished-table retention policy and disappear when their games are deleted.

The `record_game_result` service RPC inserts the snapshot and human player index in one transaction using `ON CONFLICT DO NOTHING`. A trigger on the transition to `game_over` captures seats under the action transaction's table lock for both human and bot commits. `src/server/history.ts` exposes the same idempotent recorder. Force-finishing an unfinished game does not create a win or history entry.

All `/api/admin/*` routes require `requireAdmin`, which checks a saved session against `ADMIN_EMAILS`. `GET /api/admin/tables?status=playing&limit=50` returns a bare array with `code`, `status`, `hostHandle`, `seats: [{ seat, name, bot }]`, `createdAt`, `lastActivity`, `rev`, and `phase`. Status can be `open`, `playing`, or `finished`; omit it for all statuses. Limit defaults to 50 and accepts 1 through 200. Seats use boolean bot flags and null names for empty chairs. `hostHandle` is null if unavailable; `rev` and `phase` are null before the first game. Activity is the active game's `updated_at`, falling back to the table creation time. Full game state stays on the server.

`POST /api/admin/tables/[code]/finish` sets the table status to `finished`, broadcasts `seats`, and returns `{ code, status: "finished" }`. It keeps the game state for inspection or rematch.

`GET /api/admin/bans` returns `[{ user_id, reason, created_at }]`. `POST` accepts exactly one of `handle` or `userId`, plus an optional `reason`, and returns the saved ban row. `DELETE` accepts `{ userId }` and returns `{ ok: true }`. Ban lookups are cached for 30 seconds per process; local ban and unban calls invalidate that entry. Other instances may retain the previous result for up to 30 seconds. `requireUser` rejects banned accounts with 403 and `This account is suspended.`. `GET /api/me` passes `{ allowBanned: true }` so profile reads still work; profile writes remain blocked. The daily `prune_guests` function excludes banned users.

## Game replay

`GET /api/replay/[gameId]` needs no session for a finished game: a game id is an unguessable uuid
that only its players receive (through the table snapshot and `/api/history`), so holding the link
is the permission, and players share it deliberately. While a game is still going, only its seated
players may open the replay (403 for anyone else); the link becomes public once the game is over.
The handler is rate limited per forwarded client address.

The server reads the game, its `game_actions` log and its `game_results` snapshot, then rebuilds the
game with `rebuildFromLog` in `src/engine/replay.ts`: `newGame(seed, rules, dealer)` followed by every
logged action, where the opening dealer is the seat before the first bidder. If the replay does not
reach the stored state (an engine change since the game was played) the route answers 422.
`buildReplay` then packs the result as `{ start, steps, hands, finished }`: `start` is the position
after the first deal and each step is one action; a step that dealt cards (a new hand or an all-pass
redeal) also carries the position after it. Every embedded position has its `seed` blanked and the
browser replays actions with `applyAction`. For a game still in progress the steps stop at the last
`hand_over`, so the hand being played and its deal never leave the server; before the first hand is
over the route answers 404. Tables with `revealHands` off are
replayable only once the game is over. The payload adds `seats` (display names and bot flags from the
result snapshot, or the live seats for an unfinished game), the table `code`, `viewerSeat` for a
signed-in player so the board faces them, and timestamps. No user ids are included.

`/replay/[gameId]` renders it: `walk()` in `src/components/replay/model.ts` expands the steps into
positions, merges a player's lay-down and confirm into one move, and groups moves into hands with
their `HandRecord`. The address carries `?m=<frame>` so a copied link opens at that move. The live
table links to the replay of its current game once a hand is complete; the lobby's past games link to
theirs. `/dev/replay` (local only) shows the viewer on a game the bots play on the spot.

## Operational telemetry

`src/server/metrics.ts` batches approximate counters per process. `bump(key, n = 1)` returns immediately and flushes after five seconds or 50 calls, using one `bump_metric` RPC per distinct key. The service-role-only `metrics` table stores one row per UTC day and key. The RPC atomically adds each batch to `count`. Failed batches are dropped without retries. A stopped or frozen serverless process can lose its pending batch; these counters are for operations, not billing or audit.

The keys are `act`, `act_conflict`, `tick`, `tick_noop`, `tick_fail`, `broadcast_fail`, `resync_view`, `rate_limited`, `cleanup_run`, `cleanup_finished_tables`, `cleanup_deleted_tables`, and `cleanup_pruned_guests`. `act` counts calls to the action route. `act_conflict` counts stale expected revisions, including revision races at commit. `tick` counts bot-worker runs, including automatic melding; `tick_noop` counts runs returning without an action, and `tick_fail` counts thrown failures. `broadcast_fail` includes transport errors and HTTP failures. `resync_view` counts view requests carrying `x-meld-resync: 1`. `rate_limited` counts quota rejections, including the unfinished-table cap. Cleanup counters record authorized cron attempts and the numbers of tables finished, tables deleted, and guests pruned.

The daily cron deletes metric rows with a day older than 30 days and saves `app_settings.last_cleanup` as `{ at, summary }` after successful cleanup. The summary retains `tablesFinished`, `tablesDeleted`, `rateLimitsDeleted`, and `guestsDeleted`. Admin usage stats keep their existing fields and add zero-filled `today` and `yesterday` counter maps, plus `lastCleanup`, which is null before the first successful cleanup.

Storage is bounded at roughly 31 days times 12 keys, or 372 rows after cleanup. Each batch makes one RPC per distinct key. Low-volume processes flush every five seconds while counters are pending; bursts can reach the 50-call threshold sooner. No event payloads, user IDs, or table codes are stored in telemetry. It uses the existing Supabase database and daily cron without another service.

## Tablemates and friend requests

`GET /api/tables/[code]/tablemates` requires a seated human, including a seated guest. It returns the other seated humans as `[{ userId, handle, displayName, status }]`, ordered by seat. Status is `friend`, `pending_out`, `pending_in`, `none`, or `guest`. Bots and empty seats are excluded. A service-only SQL function checks seating and joins Auth's anonymous flag without exposing other Auth fields.

`POST /api/friends` accepts exactly one of `{ handle }` or `{ userId }`. The latter requires a UUID. Both paths consume the same friend-request quota, resolve an existing profile, reject self requests, and require the target to have a saved account. Guests can save their account before receiving friend requests.

Hand recap is built by `viewFor` from the current hand's public bids, declared melds,
completed tricks and current trick. Private JSON state keeps completed trick winners
and card-counter totals, plus passes indexed by seat. Only the viewer's sent and
received passes enter `PlayerView.recap`. Trick indexes start at 1; counters exclude
the last-trick bonus. Deal resets these records. Missing fields in older games are
read as empty, and missing pace is exposed as `live`.

Rules accept `pace: "live" | "leisurely"`. Cron passes `leisurelyIdleDays` to
`cleanup_tables`; leisurely tables use that timeout rather than `idleTableHours`,
including time spent paused. Visits do not refresh game activity or delay cleanup.

`POST /api/tables/[code]/seen` accepts `{ rev }` for seated humans. The service-only
`mark_table_seen` function checks membership and revision under the table lock,
then upserts `table_visits` without moving the seen revision backward. The table
snapshot exposes `lastSeenRev`, or null when no visit is available. Starting a new
game clears visits because revision numbers restart. `last_seen` records the write
time. The client can write when hidden or every few minutes rather than per render.

## Notifications

Web Push uses `web-push` and the browser's push service, with no paid notification
provider. Optional `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT`
configure delivery. Keep the key pair stable across deployments. `GET /api/push/key`
returns `{ publicKey }`, or null when unconfigured. Authenticated
`POST /api/push/subscribe` saves `{ subscription }`; `DELETE` takes `{ endpoint }`
and removes only that user's subscription. Endpoints must belong to a supported
browser push provider. Subscription keys and the throttle log are service-role only.

After committed human and bot actions, `src/server/push.ts` schedules delivery with
Next.js `after()`, with a two-second budget. Only leisurely tables notify absent
humans. A visit within two minutes suppresses delivery. The next human gets a phase
prompt; melding prompts each human who has not confirmed. Hand and game endings
notify all absent humans once per ending. An atomic `claim_push` RPC limits each
user to one notification per table per ten minutes across workers, including
failed attempts. `push_log` keeps one row per user and table and cascades on deletion.
Expired endpoints returning 404 or 410 are deleted. `push_sent` and `push_fail`
count delivery outcomes using the existing approximate telemetry.

`usePushNotifications()` in `src/lib/push.ts` exposes `supported`, `enabled`,
`enable()`, `disable()`, `busy`, and `error` for the settings toggle. Call `enable()`
from a user gesture. The hook registers `/sw.js`; the worker displays notifications
and focuses or opens the table URL. Browser permission and push availability vary,
including installed-app requirements on iOS. No notification UI is included here.
