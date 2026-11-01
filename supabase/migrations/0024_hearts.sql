begin;
-- A second game: hearts. Tables carry the kind; games.state keeps that kind's shape.
alter table public.tables drop constraint if exists tables_game_kind_check;
alter table public.tables add constraint tables_game_kind_check check (game_kind in ('pinochle','hearts'));

-- Hearts has no teams: a result's winner is the winning seat ('0'..'3') and each player's "team" is their seat ('s0'..'s3').
alter table public.game_results drop constraint if exists game_results_winner_check;
alter table public.game_results add constraint game_results_winner_check check (winner in ('red','blue','0','1','2','3'));
alter table public.game_result_players drop constraint if exists game_result_players_team_check;
alter table public.game_result_players add constraint game_result_players_team_check check (team in ('red','blue','s0','s1','s2','s3'));

create or replace function public.record_game_result(p_game uuid) returns void
language plpgsql security definer set search_path='' as $$
declare g public.games; snapshot jsonb; inserted uuid;
begin
 select * into g from public.games where id=p_game;
 if g.id is null or g.state->>'phase'<>'game_over' then return; end if;
 select jsonb_agg(jsonb_build_object('seat',s.seat,'user_id',s.user_id,
  'name',coalesce(p.display_name,s.bot,'Empty seat'),'bot',s.bot is not null) order by s.seat)
 into snapshot from public.seats s left join public.profiles p on p.id=s.user_id where s.table_id=g.table_id;
 insert into public.game_results(game_id,table_id,code,finished_at,score,winner,hands,seats)
 select g.id,g.table_id,t.code,g.updated_at,g.state->'score',g.state->>'winner',jsonb_array_length(g.state->'history'),coalesce(snapshot,'[]'::jsonb)
 from public.tables t where t.id=g.table_id on conflict(game_id) do nothing returning game_id into inserted;
 if inserted is null then return; end if;
 if g.game_kind='hearts' then
  insert into public.game_result_players(game_id,user_id,team,won)
  select g.id,(s->>'user_id')::uuid,'s'||(s->>'seat'),(s->>'seat')=g.state->>'winner'
  from jsonb_array_elements(snapshot) s where s->>'user_id' is not null
  on conflict(game_id,user_id) do nothing;
 else
  insert into public.game_result_players(game_id,user_id,team,won)
  select g.id,(s->>'user_id')::uuid,
   case when (s->>'seat')::int%2=0 then 'red' else 'blue' end,
   (case when (s->>'seat')::int%2=0 then 'red' else 'blue' end)=g.state->>'winner'
  from jsonb_array_elements(snapshot) s where s->>'user_id' is not null
  on conflict(game_id,user_id) do nothing;
 end if;
end $$;

create or replace function public.record_abandoned_game(p_game uuid) returns void
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
  case when g.game_kind='hearts' then 's'||(s->>'seat') when (s->>'seat')::int%2=0 then 'red' else 'blue' end,null
 from jsonb_array_elements(snapshot) s where s->>'user_id' is not null
 on conflict(game_id,user_id) do nothing;
end $$;
commit;
