begin;
create table public.push_subscriptions (
 user_id uuid not null references public.profiles on delete cascade,
 endpoint text primary key,
 keys jsonb not null,
 created_at timestamptz not null default now(),
 last_ok timestamptz
);
create index push_subscriptions_user on public.push_subscriptions(user_id);
create table public.push_log (
 table_id uuid not null references public.tables on delete cascade,
 user_id uuid not null references public.profiles on delete cascade,
 last_push_at timestamptz not null default now(),
 last_event text,
 primary key(table_id,user_id)
);
alter table public.push_subscriptions enable row level security;
alter table public.push_log enable row level security;
revoke all on public.push_subscriptions, public.push_log from public,anon,authenticated;
grant all on public.push_subscriptions, public.push_log to service_role;

-- Serialize competing workers and recheck presence at the point of claiming.
create function public.claim_push(p_table uuid,p_user uuid,p_event text default null) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.table_visits where table_id=p_table and user_id=p_user
  and last_seen>=now()-interval '2 minutes') then return false; end if;
 insert into public.push_log(table_id,user_id,last_event) values(p_table,p_user,p_event)
 on conflict(table_id,user_id) do update set last_push_at=now(),
 last_event=coalesce(excluded.last_event,public.push_log.last_event)
 where public.push_log.last_push_at<=now()-interval '10 minutes'
 and (p_event is null or public.push_log.last_event is distinct from p_event);
 return found;
end $$;
revoke all on function public.claim_push(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.claim_push(uuid,uuid,text) to service_role;
commit;
