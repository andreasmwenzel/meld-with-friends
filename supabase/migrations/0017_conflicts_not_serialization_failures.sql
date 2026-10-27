begin;
-- Logical conflicts (stale revision, table changed) raise PT409, which the API answers as HTTP 409.
-- 40001 is a serialization failure that the API retries, so a stale request was replayed until the
-- upstream timeout and held API connections. Latest definitions, with only those error codes changed.
create or replace function public.commit_game_action(p_game uuid,p_user uuid,p_old_rev integer,p_state jsonb,p_action jsonb,p_request_id text) returns integer language plpgsql security definer set search_path='' as $$
declare next_rev integer := p_old_rev+1; g public.games; t public.tables;
begin
 select * into t from public.tables where id=(select table_id from public.games where id=p_game) for update;
 if t.paused_by is not null then raise exception 'The table is paused.' using errcode='PT409'; end if;
 if t.current_game_id is distinct from p_game or t.status<>'playing' then raise exception 'Table is not playing this game' using errcode='PT409'; end if;
 select * into g from public.games where id=p_game for update;
 if not exists(select 1 from public.seats where table_id=g.table_id and user_id=p_user and seat=(p_action->>'seat')::integer) then raise exception 'Action seat does not belong to you' using errcode='42501'; end if;
 if exists(select 1 from public.game_actions where game_id=p_game and request_id=p_request_id) then return null; end if;
 if g.rev is distinct from p_old_rev then raise exception 'Game changed; refresh and retry' using errcode='PT409'; end if;
 if p_action->>'type'='next_hand' and g.state->>'phase'='hand_over' and t.host<>p_user
  and exists(select 1 from public.seats s where s.table_id=t.id and s.user_id is not null and not g.ready @> jsonb_build_array(s.seat)) then
  raise exception 'Every human must be ready for the next hand.' using errcode='PT409';
 end if;
 if (p_state->>'rev')::integer is distinct from next_rev then raise exception 'Invalid revision' using errcode='22023'; end if;
 update public.games set state=p_state,rev=next_rev,updated_at=now() where id=p_game;
 insert into public.game_actions(game_id,seat,action,rev,request_id) values(p_game,(p_action->>'seat')::integer,p_action,next_rev,p_request_id);
 if p_state->>'phase'='game_over' then update public.tables set status='finished' where id=g.table_id; end if;
 return next_rev;
end $$;

create or replace function public.stand_in(p_table uuid,p_user uuid,p_seat integer) returns void
language plpgsql security definer set search_path='' as $$
declare t public.tables;
begin
 select * into t from public.tables where id=p_table for update;
 if t.id is null then raise exception 'Table not found' using errcode='P0002'; end if;
 if t.host is distinct from p_user then raise exception 'Only the host may replace a player' using errcode='42501'; end if;
 if not exists(select 1 from auth.users where id=p_user and is_anonymous=false) then raise exception 'Computer players need a saved account' using errcode='42501'; end if;
 if t.status<>'playing' then raise exception 'Table is not playing' using errcode='PT409'; end if;
 perform public.replace_seat_with_bot(p_table,p_seat);
end $$;

create or replace function public.rematch_game(p_table uuid,p_user uuid,p_previous uuid,p_rules jsonb,p_state jsonb) returns public.games
language plpgsql security definer set search_path='' as $$
declare t public.tables; previous public.games; g public.games;
begin
 select * into t from public.tables where id=p_table for update;
 if t.id is null then raise exception 'Table not found' using errcode='P0002'; end if;
 if t.host is distinct from p_user then raise exception 'Only the host may rematch' using errcode='42501'; end if;
 if t.current_game_id is distinct from p_previous or t.rules is distinct from p_rules then raise exception 'Table changed; refresh and retry' using errcode='PT409'; end if;
 select * into previous from public.games where id=t.current_game_id;
 if previous.id is null or (t.status<>'finished' and previous.state->>'phase'<>'game_over') then raise exception 'Game is still in progress' using errcode='PT409'; end if;
 if (select count(*) from public.seats where table_id=p_table and (user_id is not null or bot is not null))<>4 then raise exception 'Four seated players required' using errcode='22023'; end if;
 if not exists(select 1 from public.seats where table_id=p_table and user_id is not null) then raise exception 'At least one human required' using errcode='22023'; end if;
 if (p_state->>'dealer')::integer is distinct from (((previous.state->>'dealer')::integer+1)%4) then raise exception 'Invalid rematch dealer' using errcode='22023'; end if;
 insert into public.games(table_id,game_kind,state,rev) values(p_table,t.game_kind,p_state,(p_state->>'rev')::integer) returning * into g;
 update public.tables set status='playing',current_game_id=g.id where id=p_table;
 return g;
end $$;

commit;
