begin;
create table public.game_results (
 game_id uuid primary key references public.games(id) on delete cascade,
 table_id uuid not null, code text not null, finished_at timestamptz not null default now(),
 score jsonb not null, winner text not null check(winner in ('red','blue')),
 hands int not null, seats jsonb not null
);
create table public.game_result_players (
 game_id uuid references public.game_results(game_id) on delete cascade,
 user_id uuid not null, team text not null check(team in ('red','blue')), won boolean not null,
 primary key(game_id,user_id)
);
create index game_result_players_user on public.game_result_players(user_id,game_id);
create index game_results_finished on public.game_results(finished_at desc);
alter table public.game_results enable row level security;
alter table public.game_result_players enable row level security;
revoke all on public.game_results,public.game_result_players from public,anon,authenticated;
grant select on public.game_results,public.game_result_players to authenticated;
grant all on public.game_results,public.game_result_players to service_role;
create policy own_result_players on public.game_result_players for select to authenticated using(user_id=(select auth.uid()));
create policy own_results on public.game_results for select to authenticated using(
 exists(select 1 from public.game_result_players p where p.game_id=game_results.game_id and p.user_id=(select auth.uid()))
);

-- Snapshot and player index are written together. A retry never changes the snapshot.
create function public.record_game_result(p_game uuid) returns void
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
 insert into public.game_result_players(game_id,user_id,team,won)
 select g.id,(s->>'user_id')::uuid,
  case when (s->>'seat')::int%2=0 then 'red' else 'blue' end,
  (case when (s->>'seat')::int%2=0 then 'red' else 'blue' end)=g.state->>'winner'
 from jsonb_array_elements(snapshot) s where s->>'user_id' is not null
 on conflict(game_id,user_id) do nothing;
end $$;
-- Both action RPCs update games. Capture before their table lock is released.
create function public.capture_finished_game() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 perform public.record_game_result(new.id);
 return new;
end $$;
create trigger capture_finished_game after update of state on public.games for each row
 when(new.state->>'phase'='game_over' and old.state->>'phase' is distinct from 'game_over')
 execute function public.capture_finished_game();
revoke all on function public.record_game_result(uuid),public.capture_finished_game() from public,anon,authenticated;
grant execute on function public.record_game_result(uuid) to service_role;

create table public.banned_users (
 user_id uuid primary key, reason text, created_at timestamptz not null default now()
);
alter table public.banned_users enable row level security;
revoke all on public.banned_users from public,anon,authenticated;
grant all on public.banned_users to service_role;

create or replace function public.prune_guests(p_days int) returns bigint language plpgsql security definer set search_path='' as $$
declare removed bigint;
begin
 if p_days<1 then raise exception 'Invalid retention' using errcode='22023'; end if;
 delete from auth.users u where u.is_anonymous=true and u.created_at<now()-make_interval(days=>p_days)
 and not exists(select 1 from public.seats s where s.user_id=u.id)
 and not exists(select 1 from public.tables t where t.host=u.id)
 and not exists(select 1 from public.banned_users b where b.user_id=u.id);
 get diagnostics removed = row_count;
 return removed;
end $$;
commit;
