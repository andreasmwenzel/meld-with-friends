#!/usr/bin/env bash
# Abandoned games against a real PostgreSQL: applies every migration to a throwaway local container (never a
# Supabase project), then checks the results recorded when a table closes before its game is over.
# Needs Docker. Usage: scripts/test-abandoned-db.sh
set -euo pipefail
cd "$(dirname "$0")/.."
name="meld-abandoned-$$"
docker run -d --rm --name "$name" -e POSTGRES_PASSWORD=x postgres:17-alpine >/dev/null
trap 'docker stop "$name" >/dev/null' EXIT
until docker exec "$name" pg_isready -U postgres -q 2>/dev/null; do sleep 0.3; done
sleep 1
psql() { docker exec -i "$name" psql -U postgres -v ON_ERROR_STOP=1 -q -At "$@"; }
fail() { echo "FAIL: $*" >&2; exit 1; }
expect() { [ "$2" = "$3" ] || fail "$1: expected '$3', got '$2'"; echo "ok - $1"; }

# The parts of Supabase the migrations reference.
psql <<'SQL'
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth; create schema extensions; create schema realtime;
create table auth.users(id uuid primary key default gen_random_uuid(), email text, is_anonymous boolean default false,
 raw_user_meta_data jsonb default '{}', created_at timestamptz default now(), last_sign_in_at timestamptz, updated_at timestamptz);
create table auth.sessions(id uuid primary key default gen_random_uuid(), user_id uuid, created_at timestamptz, updated_at timestamptz, refreshed_at timestamp);
create table auth.refresh_tokens(id bigserial primary key, user_id text, session_id uuid, created_at timestamptz, updated_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
SQL

u() { printf '00000000-0000-0000-0000-%012d' "$1"; }
# A playing table: humans in the given seats, bots elsewhere, and a game in `phase` with `hands` completed and
# `actions` logged. Prints the game id.
table() { # code phase hands actions human-seat...
  local code=$1 phase=$2 hands=$3 actions=$4; shift 4
  local humans; humans=$(IFS=,; echo "${*:-99}")
  psql <<SQL
insert into public.tables(code,host,game_kind,status) values('$code','$(u 1)','pinochle','playing');
insert into public.seats(table_id,seat,user_id,bot) select t.id,s,
 case when s in ($humans) then ('00000000-0000-0000-0000-'||lpad((s+1)::text,12,'0'))::uuid end,
 case when s in ($humans) then null else 'Bot'||s end
 from public.tables t, generate_series(0,3) s where t.code='$code';
insert into public.games(table_id,game_kind,state,rev) select id,'pinochle',
 jsonb_build_object('phase','$phase','score',jsonb_build_object('red',120,'blue',80),'winner',case when '$phase'='game_over' then 'red' end,
  'history',(select coalesce(jsonb_agg('{}'::jsonb),'[]') from generate_series(1,$hands))),$actions
 from public.tables where code='$code';
update public.tables t set current_game_id=g.id from public.games g where g.table_id=t.id and t.code='$code';
insert into public.game_actions(game_id,seat,action,rev) select g.id,0,'{"type":"bid"}',r
 from public.games g join public.tables t on t.id=g.table_id, generate_series(1,$actions) r where t.code='$code';
SQL
  psql -c "select current_game_id from public.tables where code='$code'"
}
result() { psql -c "select concat_ws('|',abandoned,coalesce(winner,'-'),hands,score->>'red',score->>'blue') from public.game_results where game_id='$1'"; }
players() { psql -c "select coalesce(string_agg(concat(user_id,':',team,':',coalesce(won::text,'-')),',' order by user_id),'') from public.game_result_players where game_id='$1'"; }

for f in supabase/migrations/*.sql; do
  [ "$(basename "$f")" = 0022_abandoned_games.sql ] && break
  psql < "$f"
done
psql -c "insert into auth.users(id,email) select ('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'u'||i||'@example.com' from generate_series(1,4) i"

# Closed before the migration: the backfill records it, with the humans still seated.
OLD=$(table BCDFGB playing 2 30 0 2)
psql -c "update public.tables set status='finished' where code='BCDFGB'"
# Closed, then rematched before the migration: the table plays a new game and the old one is no longer current.
OLDER=$(table BCDFGH playing 1 12 0 2)
psql <<SQL
update public.tables set status='finished' where code='BCDFGH';
insert into public.games(table_id,game_kind,state,rev) select id,'pinochle','{"phase":"bidding","score":{"red":0,"blue":0},"history":[]}',0
 from public.tables where code='BCDFGH';
update public.tables t set status='playing',current_game_id=g.id from public.games g
 where g.table_id=t.id and t.code='BCDFGH' and g.id<>'$OLDER';
SQL
psql -c "update public.games set updated_at='2026-10-20 12:00:00+00' where id='$OLD'"
psql < supabase/migrations/0022_abandoned_games.sql
psql < supabase/migrations/0023_abandoned_dates.sql
expect "0023 dates a backfilled game by its last move" "$(psql -c "select finished_at from public.game_results where game_id='$OLD'")" "2026-10-20 12:00:00+00"
expect "the backfill records a game a rematch replaced" "$(result "$OLDER")" "t|-|1|120|80"
expect "the rematch in progress is not recorded" "$(psql -c "select count(*) from public.game_results r join public.tables t on t.current_game_id=r.game_id where t.code='BCDFGH'")" "0"
expect "the backfill records a game closed before the migration" "$(result "$OLD")" "t|-|2|120|80"
expect "its players are on it, neither won nor lost" "$(players "$OLD")" "$(u 1):red:-,$(u 3):red:-"

IDLE=$(table BCDFGC playing 1 20 0 1)
psql -c "update public.games set updated_at=now()-interval '3 days' where id='$IDLE'"
psql -c "update public.tables set created_at=now()-interval '3 days' where code='BCDFGC'"
psql -c "select public.cleanup_tables(48,30)" >/dev/null
expect "idle cleanup closes the table" "$(psql -c "select status from public.tables where code='BCDFGC'")" "finished"
expect "idle cleanup records the game as abandoned" "$(result "$IDLE")" "t|-|1|120|80"
expect "it is dated by its last move" "$(psql -c "select r.finished_at=g.updated_at from public.game_results r join public.games g on g.id=r.game_id where r.game_id='$IDLE'")" "t"
expect "both humans are on it" "$(players "$IDLE")" "$(u 1):red:-,$(u 2):blue:-"

LAST=$(table BCDFGD playing 0 5 0 1)
psql -c "select public.replace_seat_with_bot(id,1) from public.tables where code='BCDFGD'" >/dev/null
expect "a human leaving with another still seated closes nothing" "$(psql -c "select count(*) from public.game_results where game_id='$LAST'")" "0"
psql -c "select public.replace_seat_with_bot(id,0) from public.tables where code='BCDFGD'" >/dev/null
expect "the last human leaving closes the table" "$(psql -c "select status from public.tables where code='BCDFGD'")" "finished"
expect "it records the game in its first hand" "$(result "$LAST")" "t|-|0|120|80"
expect "the last human is on it, the earlier leaver is not" "$(players "$LAST")" "$(u 1):red:-"

EMPTY=$(table BCDFGF playing 0 0 0)
psql -c "update public.tables set status='finished' where code='BCDFGF'"
expect "a game with no logged move records nothing" "$(psql -c "select count(*) from public.game_results where game_id='$EMPTY'")" "0"

DONE=$(table BCDFGG playing 3 50 0)
psql -c "update public.games set state=jsonb_set(jsonb_set(state,'{phase}','\"game_over\"'),'{winner}','\"red\"') where id='$DONE'"
psql -c "update public.tables set status='finished' where code='BCDFGG'"
expect "a completed game keeps its ordinary result" "$(result "$DONE")" "f|red|3|120|80"

psql -c "update public.tables set status='playing' where code='BCDFGC'"
psql -c "update public.games set state=jsonb_set(state,'{score,red}','999') where id='$IDLE'"
psql -c "update public.tables set status='finished' where code='BCDFGC'"
expect "closing again leaves the first record alone" "$(result "$IDLE")" "t|-|1|120|80"

psql -c "set role authenticated; select public.record_abandoned_game('$IDLE')" 2>/dev/null && fail "a signed-in user called record_abandoned_game"
echo "ok - only the service role may record"
echo "all abandoned-game checks passed"
