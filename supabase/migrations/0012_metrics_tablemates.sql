begin;
create table public.metrics (
 day date not null, key text not null, count bigint not null default 0,
 primary key(day,key)
);
alter table public.metrics enable row level security;
revoke all on public.metrics from public,anon,authenticated;
grant all on public.metrics to service_role;
create function public.bump_metric(p_key text,p_n int default 1) returns void
language sql security definer set search_path='' set timezone='UTC' as $$
 insert into public.metrics(day,key,count) values(current_date,p_key,p_n)
 on conflict(day,key) do update set count=public.metrics.count+excluded.count;
$$;
revoke all on function public.bump_metric(text,int) from public,anon,authenticated;
grant execute on function public.bump_metric(text,int) to service_role;

-- Auth's anonymous flag never leaves this service-only projection.
create function public.tablemates(p_code text,p_user uuid)
returns table("userId" uuid,handle text,"displayName" text,status text)
language plpgsql stable security definer set search_path='' as $$
declare tid uuid;
begin
 select id into tid from public.tables where code=p_code;
 if tid is null then raise exception 'Table not found' using errcode='P0002'; end if;
 if not exists(select 1 from public.seats where table_id=tid and user_id=p_user and bot is null) then
  raise exception 'You must be seated to view tablemates' using errcode='42501';
 end if;
 return query
 select p.id,p.handle,p.display_name,
  case when u.is_anonymous then 'guest'
   when f.status='accepted' then 'friend'
   when f.status='pending' and f.requester=p_user then 'pending_out'
   when f.status='pending' then 'pending_in'
   else 'none' end
 from public.seats s join public.profiles p on p.id=s.user_id join auth.users u on u.id=p.id
 left join public.friendships f on (f.requester=p_user and f.addressee=p.id) or (f.addressee=p_user and f.requester=p.id)
 where s.table_id=tid and s.user_id<>p_user and s.bot is null order by s.seat;
end $$;
revoke all on function public.tablemates(text,uuid) from public,anon,authenticated;
grant execute on function public.tablemates(text,uuid) to service_role;
commit;
