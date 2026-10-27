#!/usr/bin/env bash
# Friend groups against a real PostgreSQL: applies every migration to a throwaway local container (never a
# Supabase project), then checks real seat rows, all-or-nothing creation and the unfriend race.
# Needs Docker. Usage: scripts/test-groups-db.sh
set -euo pipefail
cd "$(dirname "$0")/.."
name="meld-groups-$$"
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
for f in supabase/migrations/*.sql; do psql < "$f"; done

u() { printf '00000000-0000-0000-0000-%012d' "$1"; }
H=$(u 1)
psql -c "insert into auth.users(id,email) select ('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'u'||i||'@example.com' from generate_series(1,9) i"
psql -c "insert into public.friendships(requester,addressee,status) select '$H',('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'accepted' from generate_series(2,5) i"

G=$(psql -c "select public.create_friend_group('$H','Tuesday',array['$(u 2)','$(u 3)','$(u 4)','$(u 5)']::uuid[])")
psql -c "select public.create_friend_group('$H','Friday',array['$(u 6)']::uuid[])" 2>/dev/null && fail "a stranger joined a group"
expect "a refused member leaves no group behind" "$(psql -c "select count(*) from public.friend_groups where name='Friday'")" 0

psql -c "select public.deal_for_group('BCDFGH','$H','pinochle','{}','$G')" >/dev/null
T=$(psql -c "select id from public.tables where code='BCDFGH'")
expect "the host sits in chair 0 before anyone is invited" "$(psql -c "select string_agg(coalesce(user_id::text,'-'),',' order by seat) from public.seats where table_id='$T'")" "$H,-,-,-"
expect "every group member is invited" "$(psql -c "select count(*) from public.table_invites where table_id='$T'")" 4
for i in 2 3 4; do psql -c "select public.take_seat('$T',$((i-1)),'$(u "$i")')" >/dev/null; done
psql -c "select public.take_seat('$T',0,'$(u 5)')" 2>/dev/null && fail "an invitee took the host's chair"
expect "four invitees cannot lock the host out" "$(psql -c "select user_id from public.seats where table_id='$T' and seat=0")" "$H"
psql -c "select public.deal_for_group('BCDFGJ','$(u 2)','pinochle','{}','$G')" 2>/dev/null && fail "dealt for someone else's group"
expect "someone else's group deals no table" "$(psql -c "select count(*) from public.tables where host='$(u 2)'")" 0

orphans() { psql -c "select count(*) from public.friend_group_members m join public.friend_groups g on g.id=m.group_id
 where not exists(select 1 from public.friendships f where f.status='accepted'
  and least(f.requester,f.addressee)=least(g.owner,m.user_id) and greatest(f.requester,f.addressee)=greatest(g.owner,m.user_id))"; }
S=$(psql -c "select public.create_friend_group('$H','Solo','{}')")
# The insert holds its lock first: the unfriend waits, then its trigger removes the new membership.
psql -c "begin; insert into public.friend_group_members values('$S','$(u 5)'); select pg_sleep(1.5); commit;" >/dev/null &
sleep 0.5; psql -c "delete from public.friendships where addressee='$(u 5)'"; wait
expect "add, then unfriend concurrently: no membership outlives the friendship" "$(orphans)" 0
# The unfriend holds its lock first: the insert waits, re-reads the deleted row and is refused.
psql -c "begin; delete from public.friendships where addressee='$(u 4)'; select pg_sleep(1.5); commit;" >/dev/null &
sleep 0.5; psql -c "insert into public.friend_group_members values('$S','$(u 4)')" 2>/dev/null && fail "joined a group after the friendship ended"; wait
expect "unfriend, then add concurrently: the add is refused" "$(orphans)" 0

# Invitations hold the same invariant. Host 9 deals for a group of 7 and 8 while each friendship ends.
psql -c "insert into public.friendships(requester,addressee,status) values('$(u 9)','$(u 7)','accepted'),('$(u 8)','$(u 9)','accepted')"
R=$(psql -c "select public.create_friend_group('$(u 9)','Race',array['$(u 7)','$(u 8)']::uuid[])")
stray() { psql -c "select count(*) from public.table_invites i where not exists(select 1 from public.friendships f where f.status='accepted'
 and least(f.requester,f.addressee)=least(i.invited_by,i.user_id) and greatest(f.requester,f.addressee)=greatest(i.invited_by,i.user_id))"; }
# The deal holds its locks first: the unfriend waits, then its trigger withdraws the new invitation.
psql -c "begin; select public.deal_for_group('BCDFGK','$(u 9)','pinochle','{}','$R'); select pg_sleep(1.5); commit;" >/dev/null &
sleep 0.5; psql -c "delete from public.friendships where addressee='$(u 7)'"; wait
expect "deal, then unfriend concurrently: no invitation outlives the friendship" "$(stray)" 0
expect "the friend who stayed is invited" "$(psql -c "select string_agg(user_id::text,',') from public.table_invites i join public.tables t on t.id=i.table_id where t.code='BCDFGK'")" "$(u 8)"
# The unfriend holds its lock first: the deal waits, re-reads the deleted row and invites nobody.
psql -c "begin; delete from public.friendships where requester='$(u 8)'; select pg_sleep(1.5); commit;" >/dev/null &
sleep 0.5; psql -c "select public.deal_for_group('BCDFGM','$(u 9)','pinochle','{}','$R')" >/dev/null; wait
expect "unfriend, then deal concurrently: nobody is invited" "$(psql -c "select count(*) from public.table_invites i join public.tables t on t.id=i.table_id where t.code='BCDFGM'")" 0
expect "unfriend, then deal concurrently: no invitation outlives the friendship" "$(stray)" 0
# Nobody joins a group under a deal. Host 6's group starts with 2. A held lock on that friendship pauses
# the deal; meanwhile 3 is added, the hold ends, and 3 is unfriended before the deal commits. The add
# must wait for the deal, so the deal invites only 2 and the add is then refused.
psql -c "insert into public.friendships(requester,addressee,status) values('$(u 6)','$(u 2)','accepted'),('$(u 6)','$(u 3)','accepted')"
J=$(psql -c "select public.create_friend_group('$(u 6)','Join',array['$(u 2)']::uuid[])")
psql -c "begin; select 1 from public.friendships where requester='$(u 6)' and addressee='$(u 2)' for update; select pg_sleep(2); commit;" >/dev/null &
sleep 0.5; psql -c "begin; select public.deal_for_group('BCDFGN','$(u 6)','pinochle','{}','$J'); select pg_sleep(2); commit;" >/dev/null &
sleep 0.5; psql -c "select public.set_friend_group_members('$J','$(u 6)',array['$(u 2)','$(u 3)']::uuid[])" >/dev/null 2>&1 &
sleep 2; psql -c "delete from public.friendships where requester='$(u 6)' and addressee='$(u 3)'"; wait
expect "deal, add, unfriend concurrently: no invitation outlives the friendship" "$(stray)" 0
expect "deal, add, unfriend concurrently: only the member present at the deal is invited" "$(psql -c "select string_agg(user_id::text,',') from public.table_invites i join public.tables t on t.id=i.table_id where t.code='BCDFGN'")" "$(u 2)"
expect "deal, add, unfriend concurrently: no membership outlives the friendship" "$(orphans)" 0
expect "unfriending withdraws invitations" "$(psql -c "select count(*) from public.table_invites where user_id in ('$(u 4)','$(u 5)')")" 0
echo "All friend group database checks passed."
