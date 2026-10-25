begin;
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  handle text not null unique check (handle ~ '^[a-z0-9_]{3,32}$'),
  display_name text not null default '' check (length(display_name) <= 80),
  avatar_seed text not null default gen_random_uuid()::text,
  created_at timestamptz not null default now()
);
create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester uuid not null references public.profiles on delete cascade,
  addressee uuid not null references public.profiles on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','blocked')),
  created_at timestamptz not null default now(),
  check (requester <> addressee)
);
create unique index friendships_pair on public.friendships (least(requester,addressee), greatest(requester,addressee));
create table public.tables (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[23456789BCDFGHJKMNPQRSTVWXYZ]{6}$'),
  host uuid not null references public.profiles,
  game_kind text not null check (game_kind = 'pinochle'),
  status text not null default 'open' check (status in ('open','playing','finished')),
  rules jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create table public.seats (
  table_id uuid not null references public.tables on delete cascade,
  seat integer not null check (seat between 0 and 3),
  user_id uuid references public.profiles,
  primary key (table_id,seat),
  unique (table_id,user_id) deferrable initially deferred
);
create index seats_user on public.seats(user_id);
create table public.seat_trade_offers (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references public.tables on delete cascade,
  from_user uuid not null references public.profiles,
  to_user uuid not null references public.profiles,
  from_seat integer not null check (from_seat between 0 and 3),
  to_seat integer not null check (to_seat between 0 and 3),
  status text not null default 'pending' check (status in ('pending','accepted','declined','cancelled')),
  created_at timestamptz not null default now(),
  check (from_user <> to_user), check (from_seat <> to_seat)
);
create table public.games (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null unique references public.tables on delete cascade,
  game_kind text not null,
  state jsonb not null,
  rev integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.game_actions (
  id bigint generated always as identity primary key,
  game_id uuid not null references public.games on delete cascade,
  seat integer not null check (seat between 0 and 3),
  action jsonb not null,
  rev integer not null,
  created_at timestamptz not null default now(),
  unique(game_id,rev)
);

create function public.create_profile() returns trigger language plpgsql security definer set search_path = '' as $$
declare base text; candidate text; suffix integer := 0;
begin
  base := left(regexp_replace(lower(split_part(coalesce(new.email,'player'), '@', 1)), '[^a-z0-9_]', '', 'g'), 24);
  if length(base) < 3 then base := 'player'; end if;
  loop
    candidate := base || case when suffix = 0 then '' else suffix::text end;
    insert into public.profiles(id,handle,display_name) values(new.id,candidate,left(coalesce(new.raw_user_meta_data->>'full_name',base),80)) on conflict(handle) do nothing;
    if found then return new; end if;
    suffix := suffix + 1;
  end loop;
end $$;
create trigger auth_user_profile after insert on auth.users for each row execute function public.create_profile();

create function public.can_read_table(p_table uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.tables t where t.id = p_table and (t.host = auth.uid() or exists(select 1 from public.seats s where s.table_id = t.id and s.user_id = auth.uid())));
$$;
create type public.table_lookup as (id uuid, code text, host uuid, game_kind text, status text, seats jsonb);
create function public.lookup_table(code text) returns setof public.table_lookup
language sql stable security definer set search_path = '' as $$
 select t.id,t.code,t.host,t.game_kind,t.status,
 coalesce((select jsonb_agg(jsonb_build_object('seat',s.seat,'user_id',s.user_id,'handle',p.handle) order by s.seat) from public.seats s left join public.profiles p on p.id=s.user_id where s.table_id=t.id),'[]'::jsonb)
 from public.tables t where t.code=upper(trim($1));
$$;

alter table public.profiles enable row level security;
alter table public.friendships enable row level security;
alter table public.tables enable row level security;
alter table public.seats enable row level security;
alter table public.seat_trade_offers enable row level security;
alter table public.games enable row level security;
alter table public.game_actions enable row level security;
create policy profiles_read on public.profiles for select to authenticated using (true);
create policy profiles_update on public.profiles for update to authenticated using (id=auth.uid()) with check (id=auth.uid());
create policy friends_read on public.friendships for select to authenticated using (auth.uid() in (requester,addressee));
create policy friends_insert on public.friendships for insert to authenticated with check (requester=auth.uid() and status='pending');
create policy friends_update on public.friendships for update to authenticated using (auth.uid() in (requester,addressee)) with check (auth.uid() in (requester,addressee));
create policy friends_delete on public.friendships for delete to authenticated using (auth.uid() in (requester,addressee) and (status <> 'blocked' or requester=auth.uid()));
create function public.check_friend_transition() returns trigger language plpgsql set search_path = '' as $$
begin
 if new.requester <> old.requester or new.addressee <> old.addressee or new.id <> old.id or new.created_at <> old.created_at then raise exception 'Friendship identity cannot change' using errcode='22023'; end if;
 if not (old.status='pending' and new.status='accepted' and auth.uid()=old.addressee) then raise exception 'Only the recipient may accept a pending request' using errcode='42501'; end if;
 return new;
end $$;
create trigger friendship_transition before update on public.friendships for each row execute function public.check_friend_transition();
create policy tables_read on public.tables for select to authenticated using (public.can_read_table(id));
create policy seats_read on public.seats for select to authenticated using (public.can_read_table(table_id));
create policy trades_read on public.seat_trade_offers for select to authenticated using (public.can_read_table(table_id));
revoke all on public.profiles, public.friendships, public.tables, public.seats, public.seat_trade_offers, public.games, public.game_actions from anon, authenticated;
grant select on public.profiles, public.friendships, public.tables, public.seats, public.seat_trade_offers to authenticated;
grant update(handle,display_name) on public.profiles to authenticated;
grant insert(requester,addressee), update(status), delete on public.friendships to authenticated;
grant all on public.profiles, public.friendships, public.tables, public.seats, public.seat_trade_offers, public.games, public.game_actions to service_role;
grant usage,select on sequence public.game_actions_id_seq to service_role;

-- Every table mutation locks the parent table first, including trades and game start.
create function public.create_table(p_code text,p_user uuid,p_kind text,p_rules jsonb) returns public.tables language plpgsql security definer set search_path='' as $$
declare t public.tables;
begin
 insert into public.tables(code,host,game_kind,rules) values(p_code,p_user,p_kind,p_rules) returning * into t;
 insert into public.seats(table_id,seat) select t.id,generate_series(0,3);
 return t;
end $$;
create function public.take_seat(table_id uuid,seat integer,user_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare t public.tables;
begin
 select * into t from public.tables where id=$1 for update;
 if t.id is null then raise exception 'Table not found' using errcode='P0002'; end if;
 if t.status <> 'open' then raise exception 'Seats are locked after game start' using errcode='22023'; end if;
 if $2 not between 0 and 3 then raise exception 'Invalid seat' using errcode='22023'; end if;
 if exists(select 1 from public.seats s where s.table_id=$1 and s.seat=$2 and s.user_id is not null and s.user_id<>$3) then raise exception 'Seat is occupied' using errcode='23505'; end if;
 update public.seats s set user_id=null where s.table_id=$1 and s.user_id=$3;
 update public.seats s set user_id=$3 where s.table_id=$1 and s.seat=$2;
 update public.seat_trade_offers o set status='cancelled' where o.table_id=$1 and o.status='pending';
end $$;
create function public.leave_seat(p_table uuid,p_user uuid) returns void language plpgsql security definer set search_path='' as $$
declare t public.tables;
begin
 select * into t from public.tables where id=p_table for update;
 if t.id is null then raise exception 'Table not found' using errcode='P0002'; end if;
 if t.status <> 'open' then raise exception 'Seats are locked after game start' using errcode='22023'; end if;
 update public.seats set user_id=null where table_id=p_table and user_id=p_user;
 update public.seat_trade_offers set status='cancelled' where table_id=p_table and status='pending' and p_user in (from_user,to_user);
end $$;
create function public.offer_seat_trade(p_table uuid,p_user uuid,p_to uuid) returns public.seat_trade_offers language plpgsql security definer set search_path='' as $$
declare t public.tables; a integer; b integer; offer public.seat_trade_offers;
begin
 select * into t from public.tables where id=p_table for update;
 if t.status is distinct from 'open' then raise exception 'Table is not open' using errcode='22023'; end if;
 select seat into a from public.seats where table_id=p_table and user_id=p_user;
 select seat into b from public.seats where table_id=p_table and user_id=p_to;
 if a is null or b is null or a=b then raise exception 'Both players must occupy different seats' using errcode='22023'; end if;
 update public.seat_trade_offers set status='cancelled' where table_id=p_table and status='pending' and (from_user in (p_user,p_to) or to_user in (p_user,p_to));
 insert into public.seat_trade_offers(table_id,from_user,to_user,from_seat,to_seat) values(p_table,p_user,p_to,a,b) returning * into offer;
 return offer;
end $$;
create function public.answer_seat_trade(p_offer uuid,p_user uuid,p_accept boolean) returns text language plpgsql security definer set search_path='' as $$
declare offer public.seat_trade_offers; t public.tables;
begin
 select * into offer from public.seat_trade_offers where id=p_offer;
 if offer.id is null then raise exception 'Offer not found' using errcode='P0002'; end if;
 select * into t from public.tables where id=offer.table_id for update;
 select * into offer from public.seat_trade_offers where id=p_offer for update;
 if offer.to_user<>p_user then raise exception 'Only the recipient may answer' using errcode='42501'; end if;
 if offer.status<>'pending' or t.status<>'open' then raise exception 'Offer is no longer pending' using errcode='22023'; end if;
 if p_accept then
   if not exists(select 1 from public.seats where table_id=t.id and seat=offer.from_seat and user_id=offer.from_user) or not exists(select 1 from public.seats where table_id=t.id and seat=offer.to_seat and user_id=offer.to_user) then raise exception 'Seats changed' using errcode='22023'; end if;
   update public.seats set user_id=case seat when offer.from_seat then offer.to_user else offer.from_user end where table_id=t.id and seat in (offer.from_seat,offer.to_seat);
   update public.seat_trade_offers set status='cancelled' where table_id=t.id and status='pending' and id<>p_offer;
 end if;
 update public.seat_trade_offers set status=case when p_accept then 'accepted' else 'declined' end where id=p_offer;
 return t.code;
end $$;
create function public.start_game(p_table uuid,p_user uuid,p_state jsonb) returns public.games language plpgsql security definer set search_path='' as $$
declare t public.tables; g public.games;
begin
 select * into t from public.tables where id=p_table for update;
 if t.host is distinct from p_user then raise exception 'Only the host may start' using errcode='42501'; end if;
 if t.status<>'open' then raise exception 'Game already started' using errcode='22023'; end if;
 if (select count(*) from public.seats where table_id=p_table and user_id is not null)<>4 then raise exception 'Four seated players required' using errcode='22023'; end if;
 insert into public.games(table_id,game_kind,state,rev) values(p_table,t.game_kind,p_state,(p_state->>'rev')::integer) returning * into g;
 update public.tables set status='playing' where id=p_table;
 update public.seat_trade_offers set status='cancelled' where table_id=p_table and status='pending';
 return g;
end $$;
create function public.commit_game_action(p_game uuid,p_user uuid,p_old_rev integer,p_state jsonb,p_action jsonb) returns integer language plpgsql security definer set search_path='' as $$
declare next_rev integer := p_old_rev+1; tid uuid;
begin
 select table_id into tid from public.games where id=p_game;
 if not exists(select 1 from public.seats where table_id=tid and user_id=p_user and seat=(p_action->>'seat')::integer) then raise exception 'Action seat does not belong to you' using errcode='42501'; end if;
 if (p_state->>'rev')::integer is distinct from next_rev then raise exception 'Invalid revision' using errcode='22023'; end if;
 update public.games set state=p_state,rev=next_rev,updated_at=now() where id=p_game and rev=p_old_rev;
 if not found then raise exception 'Game changed; refresh and retry' using errcode='40001'; end if;
 insert into public.game_actions(game_id,seat,action,rev) values(p_game,(p_action->>'seat')::integer,p_action,next_rev);
 if p_state->>'phase'='game_over' then update public.tables set status='finished' where id=tid; end if;
 return next_rev;
end $$;

-- Mutation RPCs accept an explicit verified user id and must never be callable by clients.
revoke all on function public.create_profile(),public.check_friend_transition() from public,anon,authenticated;
revoke all on function public.can_read_table(uuid) from public,anon;
grant execute on function public.can_read_table(uuid) to authenticated,service_role;
revoke all on function public.lookup_table(text) from public;
grant execute on function public.lookup_table(text) to anon,authenticated,service_role;
revoke all on function public.create_table(text,uuid,text,jsonb),public.take_seat(uuid,integer,uuid),public.leave_seat(uuid,uuid),public.offer_seat_trade(uuid,uuid,uuid),public.answer_seat_trade(uuid,uuid,boolean),public.start_game(uuid,uuid,jsonb),public.commit_game_action(uuid,uuid,integer,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.create_table(text,uuid,text,jsonb),public.take_seat(uuid,integer,uuid),public.leave_seat(uuid,uuid),public.offer_seat_trade(uuid,uuid,uuid),public.answer_seat_trade(uuid,uuid,boolean),public.start_game(uuid,uuid,jsonb),public.commit_game_action(uuid,uuid,integer,jsonb,jsonb) to service_role;
commit;
