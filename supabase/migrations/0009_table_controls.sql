begin;
alter table public.games add column ready jsonb not null default '[]'::jsonb check (jsonb_typeof(ready)='array');
alter table public.tables add column paused_by uuid references public.profiles(id) on delete set null,
 add column paused_reason text check (length(paused_reason)<=80), add column paused_at timestamptz;

create function public.control_table(p_table uuid,p_user uuid,p_operation text,p_value text default null) returns void
language plpgsql security definer set search_path='' as $$
declare t public.tables; chair integer; g public.games;
begin
 select * into t from public.tables where id=p_table for update;
 if t.id is null then raise exception 'Table not found' using errcode='P0002'; end if;
 select seat into chair from public.seats where table_id=p_table and user_id=p_user and bot is null;
 if p_operation='ready' then
  if chair is null then raise exception 'You must be seated to ready' using errcode='42501'; end if;
  select * into g from public.games where id=t.current_game_id for update;
  if g.id is null or g.state->>'phase'<>'hand_over' then raise exception 'The hand is not over' using errcode='40001'; end if;
  if not g.ready @> jsonb_build_array(chair) then
   update public.games set ready=ready || jsonb_build_array(chair) where id=g.id;
  end if;
 elsif p_operation='pause' then
  if chair is null and t.host<>p_user then raise exception 'You must be seated or host to pause' using errcode='42501'; end if;
  if length(p_value)>80 then raise exception 'Reason must be at most 80 characters' using errcode='22023'; end if;
  if t.paused_by is not null then raise exception 'The table is already paused.' using errcode='40001'; end if;
  update public.tables set paused_by=p_user,paused_reason=p_value,paused_at=now() where id=p_table;
 elsif p_operation='resume' then
  if p_user is distinct from t.paused_by and p_user<>t.host then raise exception 'Only the pauser or host may resume' using errcode='42501'; end if;
  update public.tables set paused_by=null,paused_reason=null,paused_at=null where id=p_table;
 elsif p_operation='host' then
  if t.host<>p_user then raise exception 'Only the host may transfer hosting' using errcode='42501'; end if;
  if not exists(select 1 from public.seats s join auth.users u on u.id=s.user_id
   where s.table_id=p_table and s.user_id=p_value::uuid and s.bot is null and u.is_anonymous=false) then
   raise exception 'New host must be a seated human with a saved account' using errcode='22023';
  end if;
  update public.tables set host=p_value::uuid where id=p_table;
 else raise exception 'Invalid table operation' using errcode='22023';
 end if;
end $$;
revoke all on function public.control_table(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.control_table(uuid,uuid,text,text) to service_role;

-- Clear readiness for every path that leaves the hand summary, including service writes.
create function public.reset_game_ready() returns trigger language plpgsql set search_path='' as $$
begin
 if new.state->>'phase'<>'hand_over' then new.ready := '[]'::jsonb; end if;
 return new;
end $$;
create trigger reset_game_ready before update of state on public.games for each row execute function public.reset_game_ready();

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
  if t.host=p_user then
   update public.tables set host=coalesce((select s.user_id from public.seats s join auth.users u on u.id=s.user_id
    where s.table_id=p_table and s.user_id is not null and s.bot is null
    order by (u.is_anonymous is false) desc,s.seat limit 1),host) where id=p_table;
  end if;
  return;
 end if;
 if t.status<>'open' then raise exception 'Seats are locked after game start' using errcode='22023'; end if;
 update public.seats set user_id=null where table_id=p_table and user_id=p_user;
 update public.seat_trade_offers set status='cancelled' where table_id=p_table and status='pending' and p_user in (from_user,to_user);
end $$;

create or replace function public.commit_game_action(p_game uuid,p_user uuid,p_old_rev integer,p_state jsonb,p_action jsonb,p_request_id text) returns integer language plpgsql security definer set search_path='' as $$
declare next_rev integer := p_old_rev+1; g public.games; t public.tables;
begin
 select * into t from public.tables where id=(select table_id from public.games where id=p_game) for update;
 if t.paused_by is not null then raise exception 'The table is paused.' using errcode='40001'; end if;
 if t.current_game_id is distinct from p_game or t.status<>'playing' then raise exception 'Table is not playing this game' using errcode='40001'; end if;
 select * into g from public.games where id=p_game for update;
 if not exists(select 1 from public.seats where table_id=g.table_id and user_id=p_user and seat=(p_action->>'seat')::integer) then raise exception 'Action seat does not belong to you' using errcode='42501'; end if;
 if exists(select 1 from public.game_actions where game_id=p_game and request_id=p_request_id) then return null; end if;
 if g.rev is distinct from p_old_rev then raise exception 'Game changed; refresh and retry' using errcode='40001'; end if;
 if p_action->>'type'='next_hand' and g.state->>'phase'='hand_over' and t.host<>p_user
  and exists(select 1 from public.seats s where s.table_id=t.id and s.user_id is not null and not g.ready @> jsonb_build_array(s.seat)) then
  raise exception 'Every human must be ready for the next hand.' using errcode='40001';
 end if;
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
 if t.paused_by is not null then raise exception 'The table is paused.' using errcode='40001'; end if;
 if t.current_game_id is distinct from p_game or t.status<>'playing' then return null; end if;
 tid := t.id;
 if p_action->>'type'='next_hand' then raise exception 'Bots cannot advance hands' using errcode='22023'; end if;
 if not exists(select 1 from public.seats where table_id=tid and seat=(p_action->>'seat')::integer and bot is not null and user_id is null) then raise exception 'Seat is not a bot' using errcode='42501'; end if;
 if (p_state->>'rev')::integer is distinct from next_rev then raise exception 'Invalid revision' using errcode='22023'; end if;
 update public.games set state=p_state,rev=next_rev,updated_at=now() where id=p_game and rev=p_old_rev;
 if not found then return null; end if;
 insert into public.game_actions(game_id,seat,action,rev,by_bot) values(p_game,(p_action->>'seat')::integer,p_action,next_rev,true);
 if p_state->>'phase'='game_over' then update public.tables set status='finished' where id=tid; end if;
 return next_rev;
end $$;

create or replace function public.cleanup_tables(p_idle_hours int,p_retain_days int) returns jsonb
language plpgsql security definer set search_path='' as $$
declare finished bigint; removed bigint; rates bigint;
begin
 if p_idle_hours<1 or p_retain_days<1 then raise exception 'Invalid retention' using errcode='22023'; end if;
 update public.tables t set status='finished' where status in ('open','playing')
 and (t.paused_by is null or t.paused_at<=now()-interval '24 hours')
 and greatest(t.created_at,(select max(g.updated_at) from public.games g where g.table_id=t.id))<now()-make_interval(hours=>p_idle_hours);
 get diagnostics finished = row_count;
 delete from public.tables t where status='finished'
 and greatest(t.created_at,(select max(g.updated_at) from public.games g where g.table_id=t.id))<now()-make_interval(days=>p_retain_days);
 get diagnostics removed = row_count;
 delete from public.rate_limits where window_start<now()-interval '2 hours';
 get diagnostics rates = row_count;
 return jsonb_build_object('tablesFinished',finished,'tablesDeleted',removed,'rateLimitsDeleted',rates);
end $$;

commit;
