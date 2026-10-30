begin;
alter table public.game_results add column abandoned boolean not null default false;
-- The existing winner check still restricts non-null values to red or blue.
alter table public.game_results alter column winner drop not null;
alter table public.game_result_players alter column won drop not null;

-- Snapshot and player index are inserted together, once. A game needs a logged action.
create function public.record_abandoned_game(p_game uuid) returns void
language plpgsql security definer set search_path='' as $$
declare g public.games; snapshot jsonb; inserted uuid;
begin
 select * into g from public.games where id=p_game;
 if g.id is null or g.state->>'phase'='game_over'
  or not exists(select 1 from public.game_actions where game_id=p_game) then return; end if;
 select jsonb_agg(jsonb_build_object('seat',s.seat,'user_id',s.user_id,
  'name',coalesce(p.display_name,s.bot,'Empty seat'),'bot',s.bot is not null) order by s.seat)
 into snapshot from public.seats s left join public.profiles p on p.id=s.user_id where s.table_id=g.table_id;
 insert into public.game_results(game_id,table_id,code,finished_at,score,winner,hands,seats,abandoned)
 select g.id,g.table_id,t.code,now(),g.state->'score',null,jsonb_array_length(g.state->'history'),coalesce(snapshot,'[]'::jsonb),true
 from public.tables t where t.id=g.table_id on conflict(game_id) do nothing returning game_id into inserted;
 if inserted is null then return; end if;
 insert into public.game_result_players(game_id,user_id,team,won)
 select g.id,(s->>'user_id')::uuid,
  case when (s->>'seat')::int%2=0 then 'red' else 'blue' end,null
 from jsonb_array_elements(snapshot) s where s->>'user_id' is not null
 on conflict(game_id,user_id) do nothing;
end $$;
create function public.capture_abandoned_game() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 perform public.record_abandoned_game(new.current_game_id);
 return new;
end $$;
create trigger capture_abandoned_game after update of status on public.tables for each row
 when(new.status='finished' and old.status is distinct from 'finished' and new.current_game_id is not null)
 execute function public.capture_abandoned_game();
revoke all on function public.record_abandoned_game(uuid),public.capture_abandoned_game() from public,anon,authenticated;
grant execute on function public.record_abandoned_game(uuid) to service_role;

create or replace function public.replace_seat_with_bot(p_table uuid,p_seat integer) returns void
language plpgsql security definer set search_path='' as $$
declare chosen text;
begin
 if p_seat is null or p_seat not between 0 and 3 then raise exception 'Invalid seat' using errcode='22023'; end if;
 if not exists(select 1 from public.seats where table_id=p_table and seat=p_seat and user_id is not null) then raise exception 'No human in that seat' using errcode='22023'; end if;
 -- Capture the last human before their chair becomes a bot. Callers hold the table lock.
 if not exists(select 1 from public.seats where table_id=p_table and user_id is not null and seat<>p_seat) then
  perform public.record_abandoned_game(current_game_id) from public.tables where id=p_table;
 end if;
 select name into chosen from unnest(array['Mabel','Otto','Pearl','Gus','Hazel','Walt']) with ordinality as names(name,ord)
 where not exists(select 1 from public.seats where table_id=p_table and bot=name) order by ord limit 1;
 update public.seats set user_id=null,bot=chosen where table_id=p_table and seat=p_seat;
 if not exists(select 1 from public.seats where table_id=p_table and user_id is not null) then
  update public.tables set status='finished' where id=p_table;
 end if;
end $$;

-- Backfill every game that can no longer continue: the current game of a closed table, or an earlier game a
-- rematch replaced. Seats come from the table as it is now, so departed humans cannot be recovered.
select public.record_abandoned_game(g.id)
from public.games g join public.tables t on t.id=g.table_id
where g.state->>'phase'<>'game_over' and (t.status='finished' or t.current_game_id is distinct from g.id);
commit;
