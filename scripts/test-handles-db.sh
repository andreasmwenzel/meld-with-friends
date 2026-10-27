#!/usr/bin/env bash
# Word handles against a real PostgreSQL: applies every migration to a throwaway local container (never a
# Supabase project) with old-style player handles in place, then checks the backfill, sign-up and re-rolls.
# Needs Docker. Usage: scripts/test-handles-db.sh
set -euo pipefail
cd "$(dirname "$0")/.."
name="meld-handles-$$"
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

# Sign-ups before 0020 get the old handles: player, player1, an email name.
for f in supabase/migrations/*.sql; do [[ "$f" == *0020_* ]] && break; psql < "$f"; done
psql -c "insert into auth.users(email) values (null),(null),(null),('margaret.h@example.com')"
psql -c "insert into auth.users(email) values ('jonah@example.com')"
CHOSEN=$(psql -c "update public.profiles set handle='card_shark' where handle='jonah' returning id")
expect "old sign-ups get player and email handles" "$(psql -c "select string_agg(handle,',' order by handle) from public.profiles")" "card_shark,margareth,player,player1,player2"

psql < supabase/migrations/0020_word_handles.sql
expect "the backfill replaces player and email handles" "$(psql -c "select count(*) from public.profiles where handle ~ '^player[0-9]*$' or handle like 'margareth%'")" 0
expect "a handle the player chose is kept" "$(psql -c "select handle from public.profiles where id='$CHOSEN'")" "card_shark"
expect "backfilled handles are two words" "$(psql -c "select count(*) from public.profiles where handle ~ '^[a-z]+_[a-z]+$' and handle <> 'card_shark'")" 4

psql -c "insert into auth.users(email) select null from generate_series(1,300)"
expect "new sign-ups get unique two-word handles" "$(psql -c "select count(*) filter (where handle ~ '^[a-z]+_[a-z]+(_[0-9]{2})?$'), count(distinct handle) from public.profiles where handle <> 'card_shark'")" "304|304"

M=$CHOSEN
N=$(psql -c "select public.regenerate_handle('$M')")
expect "a re-roll saves the drawn handle" "$(psql -c "select handle from public.profiles where id='$M'")" "$N"
psql -c "select public.regenerate_handle(gen_random_uuid())" 2>/dev/null && fail "re-rolled a missing profile"
expect "only the service role may re-roll" "$(psql -c "select has_function_privilege('authenticated','public.regenerate_handle(uuid)','execute')::text || has_function_privilege('service_role','public.regenerate_handle(uuid)','execute')::text")" "falsetrue"
