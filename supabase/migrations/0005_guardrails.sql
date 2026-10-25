begin;
create table public.app_settings (
 key text primary key, value jsonb not null default '{}', updated_at timestamptz default now()
);
create table public.rate_limits (
 key text not null, window_start timestamptz not null, count int not null,
 primary key(key, window_start)
);
alter table public.app_settings enable row level security;
alter table public.rate_limits enable row level security;
revoke all on public.app_settings, public.rate_limits from public, anon, authenticated;
grant all on public.app_settings, public.rate_limits to service_role;
create index rate_limits_expiry on public.rate_limits(window_start);
create index tables_created on public.tables(created_at);
create index tables_host_status on public.tables(host,status);
create index game_actions_created on public.game_actions(created_at);
alter table public.game_actions add column by_bot boolean not null default false;
update public.game_actions a set by_bot=true from public.games g, public.seats s
 where a.game_id=g.id and s.table_id=g.table_id and a.seat=s.seat and s.bot is not null;

create function public.consume_rate(p_key text,p_limit int,p_window_seconds int) returns boolean
language plpgsql security definer set search_path='' as $$
declare start_at timestamptz; used int;
begin
 if p_limit<1 or p_window_seconds<1 then raise exception 'Invalid rate limit' using errcode='22023'; end if;
 start_at := to_timestamp(floor(extract(epoch from now())/p_window_seconds)*p_window_seconds);
 insert into public.rate_limits as r(key,window_start,count) values(p_key,start_at,1)
 on conflict(key,window_start) do update set count=r.count+1 where r.count<p_limit
 returning count into used;
 return used is not null;
end $$;
create function public.patch_settings(p_patch jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 insert into public.app_settings(key) values('global') on conflict do nothing;
 update public.app_settings set value=value || p_patch ||
 jsonb_build_object('bots',coalesce(value->'bots','{}'::jsonb)||coalesce(p_patch->'bots','{}'::jsonb),
                    'limits',coalesce(value->'limits','{}'::jsonb)||coalesce(p_patch->'limits','{}'::jsonb)), updated_at=now()
 where key='global' returning value into result;
 return result;
end $$;
create function public.count_guests() returns bigint language sql stable security definer set search_path='' as $$
 select count(*) from auth.users where is_anonymous=true;
$$;
-- Historical offers must not prevent removal of otherwise unused guests.
alter table public.seat_trade_offers drop constraint seat_trade_offers_from_user_fkey,
 add constraint seat_trade_offers_from_user_fkey foreign key(from_user) references public.profiles on delete cascade;
alter table public.seat_trade_offers drop constraint seat_trade_offers_to_user_fkey,
 add constraint seat_trade_offers_to_user_fkey foreign key(to_user) references public.profiles on delete cascade;
create function public.prune_guests(p_days int) returns bigint language plpgsql security definer set search_path='' as $$
declare removed bigint;
begin
 if p_days<1 then raise exception 'Invalid retention' using errcode='22023'; end if;
 delete from auth.users u where u.is_anonymous=true and u.created_at<now()-make_interval(days=>p_days)
 and not exists(select 1 from public.seats s where s.user_id=u.id)
 and not exists(select 1 from public.tables t where t.host=u.id);
 get diagnostics removed = row_count;
 return removed;
end $$;
create function public.cleanup_tables(p_idle_hours int,p_retain_days int) returns jsonb
language plpgsql security definer set search_path='' as $$
declare finished bigint; removed bigint; rates bigint;
begin
 if p_idle_hours<1 or p_retain_days<1 then raise exception 'Invalid retention' using errcode='22023'; end if;
 update public.tables t set status='finished' where status in ('open','playing')
 and greatest(t.created_at,(select max(g.updated_at) from public.games g where g.table_id=t.id))<now()-make_interval(hours=>p_idle_hours);
 get diagnostics finished = row_count;
 delete from public.tables t where status='finished'
 and greatest(t.created_at,(select max(g.updated_at) from public.games g where g.table_id=t.id))<now()-make_interval(days=>p_retain_days);
 get diagnostics removed = row_count;
 delete from public.rate_limits where window_start<now()-interval '2 hours';
 get diagnostics rates = row_count;
 return jsonb_build_object('tablesFinished',finished,'tablesDeleted',removed,'rateLimitsDeleted',rates);
end $$;
-- API limits must also apply to clients that try writing through PostgREST.
revoke update on public.profiles from authenticated;
revoke update(handle,display_name) on public.profiles from authenticated;
revoke insert on public.friendships from authenticated;
revoke insert(requester,addressee) on public.friendships from authenticated;
create or replace function public.commit_bot_action(p_game uuid,p_old_rev integer,p_state jsonb,p_action jsonb) returns integer language plpgsql security definer set search_path='' as $$
declare tid uuid; next_rev integer := p_old_rev+1;
begin
 select table_id into tid from public.games where id=p_game;
 if not exists(select 1 from public.seats where table_id=tid and seat=(p_action->>'seat')::integer and bot is not null and user_id is null) then raise exception 'Seat is not a bot' using errcode='42501'; end if;
 if (p_state->>'rev')::integer is distinct from next_rev then raise exception 'Invalid revision' using errcode='22023'; end if;
 update public.games set state=p_state,rev=next_rev,updated_at=now() where id=p_game and rev=p_old_rev;
 if not found then return null; end if;
 insert into public.game_actions(game_id,seat,action,rev,by_bot) values(p_game,(p_action->>'seat')::integer,p_action,next_rev,true);
 if p_state->>'phase'='game_over' then update public.tables set status='finished' where id=tid; end if;
 return next_rev;
end $$;
create or replace function public.manage_bots(p_table uuid,p_user uuid,p_mode text,p_seat integer default null) returns void language plpgsql security definer set search_path='' as $$
declare t public.tables; chair record; chosen text;
begin
 if p_mode in ('add','fill') and not exists(select 1 from auth.users where id=p_user and is_anonymous=false) then raise exception 'Computer players need a saved account' using errcode='42501'; end if;
 select * into t from public.tables where id=p_table for update;
 if t.host is distinct from p_user then raise exception 'Only the host may manage bots' using errcode='42501'; end if;
 if t.status<>'open' then raise exception 'Table is not open' using errcode='22023'; end if;
 if p_mode not in ('add','remove','fill') or (p_mode<>'fill' and (p_seat is null or p_seat not between 0 and 3)) then raise exception 'Invalid bot operation' using errcode='22023'; end if;
 if p_mode='remove' then
  update public.seats set bot=null where table_id=p_table and seat=p_seat and bot is not null;
  if not found then raise exception 'No bot in that seat' using errcode='22023'; end if;
  return;
 end if;
 if p_mode='add' and exists(select 1 from public.seats where table_id=p_table and seat=p_seat and (user_id is not null or bot is not null)) then raise exception 'Seat is occupied' using errcode='23505'; end if;
 for chair in select seat from public.seats where table_id=p_table and user_id is null and bot is null and (p_mode='fill' or seat=p_seat) order by seat loop
  select name into chosen from unnest(array['Mabel','Otto','Pearl','Gus','Hazel','Walt']) with ordinality as names(name,ord) where not exists(select 1 from public.seats where table_id=p_table and bot=name) order by ord limit 1;
  update public.seats set bot=chosen where table_id=p_table and seat=chair.seat;
 end loop;
end $$;
create or replace function public.create_table(p_code text,p_user uuid,p_kind text,p_rules jsonb) returns public.tables language plpgsql security definer set search_path='' as $$
declare t public.tables; cap int;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
 select coalesce((value->'limits'->>'maxOpenTablesPerHost')::int,3) into cap from public.app_settings where key='global';
 if (select count(*) from public.tables where host=p_user and status<>'finished')>=coalesce(cap,3) then
 raise exception 'Slow down: too many unfinished tables' using errcode='P0429'; end if;
 insert into public.tables(code,host,game_kind,rules) values(p_code,p_user,p_kind,p_rules) returning * into t;
 insert into public.seats(table_id,seat) select t.id,generate_series(0,3);
 return t;
end $$;
revoke all on function public.consume_rate(text,int,int),public.patch_settings(jsonb),public.count_guests(),public.prune_guests(int),public.cleanup_tables(int,int) from public,anon,authenticated;
grant execute on function public.consume_rate(text,int,int),public.patch_settings(jsonb),public.count_guests(),public.prune_guests(int),public.cleanup_tables(int,int) to service_role;
commit;
