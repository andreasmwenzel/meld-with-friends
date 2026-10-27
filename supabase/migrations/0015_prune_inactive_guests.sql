begin;
-- Guests are pruned for inactivity, not account age. A guest's activity is the newest of: account
-- creation, last sign-in, the last update to the auth user, and the newest refresh of any of their
-- sessions. Every open tab refreshes its session about once an hour, so a guest who plays at all keeps
-- a recent refresh even while seated nowhere. Supabase Auth writes these rows itself, so they cover
-- every page and API call without Meld recording a last-seen time of its own. Both the session row
-- and its refresh tokens are checked, since Auth versions differ in which one a refresh touches.
create or replace function public.prune_guests(p_days int) returns bigint language plpgsql security definer set search_path='' as $$
declare removed bigint; cutoff timestamptz;
begin
 if p_days<1 then raise exception 'Invalid retention' using errcode='22023'; end if;
 cutoff := now()-make_interval(days=>p_days);
 delete from auth.users u where u.is_anonymous=true
 and greatest(u.created_at,u.last_sign_in_at,u.updated_at)<cutoff
 and not exists(select 1 from auth.sessions s where s.user_id=u.id and greatest(s.created_at,s.updated_at)>=cutoff)
 and not exists(select 1 from auth.refresh_tokens r where r.user_id=u.id::text and greatest(r.created_at,r.updated_at)>=cutoff)
 and not exists(select 1 from public.seats s where s.user_id=u.id)
 and not exists(select 1 from public.tables t where t.host=u.id)
 and not exists(select 1 from public.banned_users b where b.user_id=u.id);
 get diagnostics removed = row_count;
 return removed;
end $$;
revoke all on function public.prune_guests(int) from public,anon,authenticated;
grant execute on function public.prune_guests(int) to service_role;
commit;
