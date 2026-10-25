begin;

create table public.table_visits (
 table_id uuid not null references public.tables on delete cascade,
 user_id uuid not null references public.profiles on delete cascade,
 last_rev integer not null check(last_rev>=0),
 last_seen timestamptz not null default now(),
 primary key(table_id,user_id)
);
alter table public.table_visits enable row level security;
revoke all on public.table_visits from public,anon,authenticated;
grant all on public.table_visits to service_role;

create function public.mark_table_seen(p_table uuid,p_user uuid,p_rev integer) returns integer
language plpgsql security definer set search_path='' as $$
declare current_rev integer; seen_rev integer;
begin
 perform 1 from public.tables where id=p_table for update;
 if not found then raise exception 'Table not found' using errcode='P0002'; end if;
 if not exists(select 1 from public.seats where table_id=p_table and user_id=p_user and bot is null) then
  raise exception 'Only seated humans may mark a table seen' using errcode='42501';
 end if;
 select coalesce((select g.rev from public.games g join public.tables t on t.current_game_id=g.id where t.id=p_table),0) into current_rev;
 if p_rev is null or p_rev<0 or p_rev>current_rev then raise exception 'Invalid revision' using errcode='22023'; end if;
 insert into public.table_visits(table_id,user_id,last_rev) values(p_table,p_user,p_rev)
 on conflict(table_id,user_id) do update set last_rev=greatest(public.table_visits.last_rev,excluded.last_rev),last_seen=now()
 returning last_rev into seen_rev;
 return seen_rev;
end $$;
revoke all on function public.mark_table_seen(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.mark_table_seen(uuid,uuid,integer) to service_role;

-- A rematch starts revision numbering over, so visits belong to the new game.
create function public.reset_table_visits() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.current_game_id is distinct from old.current_game_id then
  delete from public.table_visits where table_id=new.id;
 end if;
 return new;
end $$;
create trigger reset_table_visits after update of current_game_id on public.tables
 for each row execute function public.reset_table_visits();
revoke all on function public.reset_table_visits() from public,anon,authenticated;

drop function public.cleanup_tables(integer,integer);
create function public.cleanup_tables(p_idle_hours int,p_retain_days int,p_leisurely_days int default 60) returns jsonb
language plpgsql security definer set search_path='' as $$
declare finished bigint; removed bigint; rates bigint;
begin
 if p_idle_hours<1 or p_retain_days<1 or p_leisurely_days<1 then raise exception 'Invalid retention' using errcode='22023'; end if;
 update public.tables t set status='finished' where status in ('open','playing')
 and (t.rules->>'pace'='leisurely' or t.paused_by is null or t.paused_at<=now()-interval '24 hours')
 and greatest(t.created_at,(select max(g.updated_at) from public.games g where g.table_id=t.id))<now()-
 case when t.rules->>'pace'='leisurely' then make_interval(days=>p_leisurely_days) else make_interval(hours=>p_idle_hours) end;
 get diagnostics finished = row_count;
 delete from public.tables t where status='finished'
 and greatest(t.created_at,(select max(g.updated_at) from public.games g where g.table_id=t.id))<now()-make_interval(days=>p_retain_days);
 get diagnostics removed = row_count;
 delete from public.rate_limits where window_start<now()-interval '2 hours';
 get diagnostics rates = row_count;
 return jsonb_build_object('tablesFinished',finished,'tablesDeleted',removed,'rateLimitsDeleted',rates);
end $$;
revoke all on function public.cleanup_tables(integer,integer,integer) from public,anon,authenticated;
grant execute on function public.cleanup_tables(integer,integer,integer) to service_role;
commit;
