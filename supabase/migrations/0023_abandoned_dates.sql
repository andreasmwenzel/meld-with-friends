begin;
-- An abandoned game is dated by its last move, not by when its table was closed or its result written.
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
 select g.id,g.table_id,t.code,g.updated_at,g.state->'score',null,jsonb_array_length(g.state->'history'),coalesce(snapshot,'[]'::jsonb),true
 from public.tables t where t.id=g.table_id on conflict(game_id) do nothing returning game_id into inserted;
 if inserted is null then return; end if;
 insert into public.game_result_players(game_id,user_id,team,won)
 select g.id,(s->>'user_id')::uuid,
  case when (s->>'seat')::int%2=0 then 'red' else 'blue' end,null
 from jsonb_array_elements(snapshot) s where s->>'user_id' is not null
 on conflict(game_id,user_id) do nothing;
end $$;

update public.game_results r set finished_at=g.updated_at from public.games g where g.id=r.game_id and r.abandoned;

commit;
