begin;
alter table public.seats add column bot text;
alter table public.seats add constraint seats_human_or_bot check (user_id is null or bot is null);
create or replace function public.lookup_table(code text) returns setof public.table_lookup
language sql stable security definer set search_path = '' as $$
 select t.id,t.code,t.host,t.game_kind,t.status,
 coalesce((select jsonb_agg(jsonb_build_object('seat',s.seat,'user_id',s.user_id,'bot',s.bot,'handle',p.handle) order by s.seat) from public.seats s left join public.profiles p on p.id=s.user_id where s.table_id=t.id),'[]'::jsonb)
 from public.tables t where t.code=upper(trim($1));
$$;
create or replace function public.take_seat(table_id uuid,seat integer,user_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare t public.tables;
begin
 select * into t from public.tables where id=$1 for update;
 if t.id is null then raise exception 'Table not found' using errcode='P0002'; end if;
 if t.status <> 'open' then raise exception 'Seats are locked after game start' using errcode='22023'; end if;
 if $2 not between 0 and 3 then raise exception 'Invalid seat' using errcode='22023'; end if;
 if exists(select 1 from public.seats s where s.table_id=$1 and s.seat=$2 and (s.bot is not null or (s.user_id is not null and s.user_id<>$3))) then raise exception 'Seat is occupied' using errcode='23505'; end if;
 update public.seats s set user_id=null where s.table_id=$1 and s.user_id=$3;
 update public.seats s set user_id=$3 where s.table_id=$1 and s.seat=$2;
 update public.seat_trade_offers o set status='cancelled' where o.table_id=$1 and o.status='pending';
end $$;
create or replace function public.start_game(p_table uuid,p_user uuid,p_state jsonb) returns public.games language plpgsql security definer set search_path='' as $$
declare t public.tables; g public.games;
begin
 select * into t from public.tables where id=p_table for update;
 if t.host is distinct from p_user then raise exception 'Only the host may start' using errcode='42501'; end if;
 if t.status<>'open' then raise exception 'Game already started' using errcode='22023'; end if;
 if (select count(*) from public.seats where table_id=p_table and (user_id is not null or bot is not null))<>4 then raise exception 'Four seated players required' using errcode='22023'; end if;
 if not exists(select 1 from public.seats where table_id=p_table and user_id is not null) then raise exception 'At least one human required' using errcode='22023'; end if;
 insert into public.games(table_id,game_kind,state,rev) values(p_table,t.game_kind,p_state,(p_state->>'rev')::integer) returning * into g;
 update public.tables set status='playing' where id=p_table;
 update public.seat_trade_offers set status='cancelled' where table_id=p_table and status='pending';
 return g;
end $$;

create function public.manage_bots(p_table uuid,p_user uuid,p_mode text,p_seat integer default null) returns void language plpgsql security definer set search_path='' as $$
declare t public.tables; chair record; chosen text;
begin
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
create function public.commit_bot_action(p_game uuid,p_old_rev integer,p_state jsonb,p_action jsonb) returns integer language plpgsql security definer set search_path='' as $$
declare tid uuid; next_rev integer := p_old_rev+1;
begin
 select table_id into tid from public.games where id=p_game;
 if not exists(select 1 from public.seats where table_id=tid and seat=(p_action->>'seat')::integer and bot is not null and user_id is null) then raise exception 'Seat is not a bot' using errcode='42501'; end if;
 if (p_state->>'rev')::integer is distinct from next_rev then raise exception 'Invalid revision' using errcode='22023'; end if;
 update public.games set state=p_state,rev=next_rev,updated_at=now() where id=p_game and rev=p_old_rev;
 if not found then raise exception 'Game changed; refresh and retry' using errcode='40001'; end if;
 insert into public.game_actions(game_id,seat,action,rev) values(p_game,(p_action->>'seat')::integer,p_action,next_rev);
 if p_state->>'phase'='game_over' then update public.tables set status='finished' where id=tid; end if;
 return next_rev;
end $$;
revoke all on function public.manage_bots(uuid,uuid,text,integer),public.commit_bot_action(uuid,integer,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.manage_bots(uuid,uuid,text,integer),public.commit_bot_action(uuid,integer,jsonb,jsonb) to service_role;
commit;
