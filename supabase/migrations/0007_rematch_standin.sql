begin;
-- Keep completed games and make the active game explicit for every reader.
alter table public.games drop constraint games_table_id_key;
create index games_table_id_created_at on public.games(table_id, created_at desc);
alter table public.tables add column current_game_id uuid references public.games(id) on delete set null;
update public.tables t set current_game_id=g.id from public.games g where g.table_id=t.id;

-- Internal helper. Callers hold the parent table lock before changing a chair.
create function public.replace_seat_with_bot(p_table uuid,p_seat integer) returns void
language plpgsql security definer set search_path='' as $$
declare chosen text;
begin
 if p_seat is null or p_seat not between 0 and 3 then raise exception 'Invalid seat' using errcode='22023'; end if;
 if not exists(select 1 from public.seats where table_id=p_table and seat=p_seat and user_id is not null) then raise exception 'No human in that seat' using errcode='22023'; end if;
 select name into chosen from unnest(array['Mabel','Otto','Pearl','Gus','Hazel','Walt']) with ordinality as names(name,ord)
 where not exists(select 1 from public.seats where table_id=p_table and bot=name) order by ord limit 1;
 update public.seats set user_id=null,bot=chosen where table_id=p_table and seat=p_seat;
 update public.seat_trade_offers set status='cancelled' where table_id=p_table and status='pending';
 if not exists(select 1 from public.seats where table_id=p_table and user_id is not null) then
  update public.tables set status='finished' where id=p_table;
 end if;
end $$;

create function public.stand_in(p_table uuid,p_user uuid,p_seat integer) returns void
language plpgsql security definer set search_path='' as $$
declare t public.tables;
begin
 select * into t from public.tables where id=p_table for update;
 if t.id is null then raise exception 'Table not found' using errcode='P0002'; end if;
 if t.host is distinct from p_user then raise exception 'Only the host may replace a player' using errcode='42501'; end if;
 if not exists(select 1 from auth.users where id=p_user and is_anonymous=false) then raise exception 'Computer players need a saved account' using errcode='42501'; end if;
 if t.status<>'playing' then raise exception 'Table is not playing' using errcode='40001'; end if;
 perform public.replace_seat_with_bot(p_table,p_seat);
end $$;

create or replace function public.leave_seat(p_table uuid,p_user uuid) returns void
language plpgsql security definer set search_path='' as $$
declare t public.tables; chair integer;
begin
 select * into t from public.tables where id=p_table for update;
 if t.id is null then raise exception 'Table not found' using errcode='P0002'; end if;
 if t.status='playing' then
  select seat into chair from public.seats where table_id=p_table and user_id=p_user;
  if chair is null then raise exception 'You must be seated to leave this game' using errcode='42501'; end if;
  -- Leaving is available to guests too, without allocating a new chair.
  perform public.replace_seat_with_bot(p_table,chair);
  return;
 end if;
 if t.status<>'open' then raise exception 'Seats are locked after game start' using errcode='22023'; end if;
 update public.seats set user_id=null where table_id=p_table and user_id=p_user;
 update public.seat_trade_offers set status='cancelled' where table_id=p_table and status='pending' and p_user in (from_user,to_user);
end $$;

create function public.rematch_game(p_table uuid,p_user uuid,p_previous uuid,p_rules jsonb,p_state jsonb) returns public.games
language plpgsql security definer set search_path='' as $$
declare t public.tables; previous public.games; g public.games;
begin
 select * into t from public.tables where id=p_table for update;
 if t.id is null then raise exception 'Table not found' using errcode='P0002'; end if;
 if t.host is distinct from p_user then raise exception 'Only the host may rematch' using errcode='42501'; end if;
 if t.current_game_id is distinct from p_previous or t.rules is distinct from p_rules then raise exception 'Table changed; refresh and retry' using errcode='40001'; end if;
 select * into previous from public.games where id=t.current_game_id;
 if previous.id is null or (t.status<>'finished' and previous.state->>'phase'<>'game_over') then raise exception 'Game is still in progress' using errcode='40001'; end if;
 if (select count(*) from public.seats where table_id=p_table and (user_id is not null or bot is not null))<>4 then raise exception 'Four seated players required' using errcode='22023'; end if;
 if not exists(select 1 from public.seats where table_id=p_table and user_id is not null) then raise exception 'At least one human required' using errcode='22023'; end if;
 if (p_state->>'dealer')::integer is distinct from (((previous.state->>'dealer')::integer+1)%4) then raise exception 'Invalid rematch dealer' using errcode='22023'; end if;
 insert into public.games(table_id,game_kind,state,rev) values(p_table,t.game_kind,p_state,(p_state->>'rev')::integer) returning * into g;
 update public.tables set status='playing',current_game_id=g.id where id=p_table;
 return g;
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
 update public.tables set status='playing',current_game_id=g.id where id=p_table;
 update public.seat_trade_offers set status='cancelled' where table_id=p_table and status='pending';
 return g;
end $$;


create or replace function public.commit_game_action(p_game uuid,p_user uuid,p_old_rev integer,p_state jsonb,p_action jsonb,p_request_id text) returns integer language plpgsql security definer set search_path='' as $$
declare next_rev integer := p_old_rev+1; g public.games; t public.tables;
begin
 select * into t from public.tables where id=(select table_id from public.games where id=p_game) for update;
 if t.current_game_id is distinct from p_game or t.status<>'playing' then raise exception 'Table is not playing this game' using errcode='40001'; end if;
 select * into g from public.games where id=p_game for update;
 if not exists(select 1 from public.seats where table_id=g.table_id and user_id=p_user and seat=(p_action->>'seat')::integer) then raise exception 'Action seat does not belong to you' using errcode='42501'; end if;
 if exists(select 1 from public.game_actions where game_id=p_game and request_id=p_request_id) then return null; end if;
 if g.rev is distinct from p_old_rev then raise exception 'Game changed; refresh and retry' using errcode='40001'; end if;
 if (p_state->>'rev')::integer is distinct from next_rev then raise exception 'Invalid revision' using errcode='22023'; end if;
 update public.games set state=p_state,rev=next_rev,updated_at=now() where id=p_game;
 insert into public.game_actions(game_id,seat,action,rev,request_id) values(p_game,(p_action->>'seat')::integer,p_action,next_rev,p_request_id);
 if p_state->>'phase'='game_over' then update public.tables set status='finished' where id=g.table_id; end if;
 return next_rev;
end $$;

create or replace function public.commit_bot_action(p_game uuid,p_old_rev integer,p_state jsonb,p_action jsonb) returns integer language plpgsql security definer set search_path='' as $$
declare t public.tables; tid uuid; next_rev integer := p_old_rev+1;
begin
 select * into t from public.tables where id=(select table_id from public.games where id=p_game) for update;
 if t.current_game_id is distinct from p_game or t.status<>'playing' then return null; end if;
 tid := t.id;
 if not exists(select 1 from public.seats where table_id=tid and seat=(p_action->>'seat')::integer and bot is not null and user_id is null) then raise exception 'Seat is not a bot' using errcode='42501'; end if;
 if (p_state->>'rev')::integer is distinct from next_rev then raise exception 'Invalid revision' using errcode='22023'; end if;
 update public.games set state=p_state,rev=next_rev,updated_at=now() where id=p_game and rev=p_old_rev;
 if not found then return null; end if;
 insert into public.game_actions(game_id,seat,action,rev,by_bot) values(p_game,(p_action->>'seat')::integer,p_action,next_rev,true);
 if p_state->>'phase'='game_over' then update public.tables set status='finished' where id=tid; end if;
 return next_rev;
end $$;

revoke all on function public.replace_seat_with_bot(uuid,integer),public.stand_in(uuid,uuid,integer),public.rematch_game(uuid,uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.replace_seat_with_bot(uuid,integer),public.stand_in(uuid,uuid,integer),public.rematch_game(uuid,uuid,uuid,jsonb,jsonb) to service_role;
commit;
