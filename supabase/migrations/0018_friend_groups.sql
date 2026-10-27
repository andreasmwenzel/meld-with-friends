begin;
-- Named groups of friends ("Tuesday four"), private to their owner. Members must be accepted friends,
-- so a group can only invite people who already agreed to know you.
create table public.friend_groups (
 id uuid primary key default gen_random_uuid(),
 owner uuid not null references public.profiles on delete cascade,
 name text not null check (name=btrim(name) and length(name) between 1 and 40),
 created_at timestamptz not null default now()
);
create unique index friend_groups_owner_name on public.friend_groups(owner,lower(name));
create table public.friend_group_members (
 group_id uuid not null references public.friend_groups on delete cascade,
 user_id uuid not null references public.profiles on delete cascade,
 created_at timestamptz not null default now(),
 primary key(group_id,user_id)
);
create index friend_group_members_user on public.friend_group_members(user_id);

-- A host who deals for a group leaves each member an invitation; it shows in their lobby while the
-- table is open and they are not seated there. Deleting the table removes it.
create table public.table_invites (
 table_id uuid not null references public.tables on delete cascade,
 user_id uuid not null references public.profiles on delete cascade,
 invited_by uuid not null references public.profiles on delete cascade,
 created_at timestamptz not null default now(),
 primary key(table_id,user_id)
);
create index table_invites_user on public.table_invites(user_id);

-- Caps hold under concurrency: each check takes a lock before counting, and runs after the insert so
-- it counts every row of a multi-row statement.
create function public.check_friend_group() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('friend_groups:'||new.owner::text,0));
 if (select count(*) from public.friend_groups where owner=new.owner)>20 then
  raise exception 'You can keep up to 20 groups' using errcode='23514';
 end if;
 return null;
end $$;
create trigger friend_group_cap after insert on public.friend_groups for each row execute function public.check_friend_group();

create function public.check_friend_group_member() returns trigger language plpgsql security definer set search_path='' as $$
declare o uuid;
begin
 select owner into o from public.friend_groups where id=new.group_id for update;
 if (select count(*) from public.friend_group_members where group_id=new.group_id)>12 then
  raise exception 'A group can have up to 12 members' using errcode='23514';
 end if;
 if not exists(select 1 from public.friendships f where f.status='accepted'
   and ((f.requester=o and f.addressee=new.user_id) or (f.addressee=o and f.requester=new.user_id))) then
  raise exception 'Only friends can be in a group' using errcode='23514';
 end if;
 return null;
end $$;
create trigger friend_group_member_check after insert on public.friend_group_members for each row execute function public.check_friend_group_member();

-- Ending a friendship takes each person out of the other's groups.
create function public.drop_unfriended_members() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.status='accepted' and (tg_op='DELETE' or new.status<>'accepted') then
  delete from public.friend_group_members m using public.friend_groups g
  where g.id=m.group_id and ((g.owner=old.requester and m.user_id=old.addressee) or (g.owner=old.addressee and m.user_id=old.requester));
 end if;
 return null;
end $$;
create trigger friendship_ends_group_membership after update or delete on public.friendships for each row execute function public.drop_unfriended_members();

-- Owners read their own groups. Writes go through the API (rate limited, service role), as with
-- friend requests since 0005; invitations are service-only.
alter table public.friend_groups enable row level security;
alter table public.friend_group_members enable row level security;
alter table public.table_invites enable row level security;
create policy friend_groups_owner on public.friend_groups for select to authenticated using (owner=auth.uid());
create policy friend_group_members_owner on public.friend_group_members for select to authenticated
 using (exists(select 1 from public.friend_groups g where g.id=group_id and g.owner=auth.uid()));
revoke all on public.friend_groups,public.friend_group_members,public.table_invites from public,anon,authenticated;
grant select on public.friend_groups,public.friend_group_members to authenticated;
grant all on public.friend_groups,public.friend_group_members,public.table_invites to service_role;

-- Replaces a group's members in one transaction, so a rejected member leaves the group unchanged.
create function public.set_friend_group_members(p_group uuid,p_user uuid,p_members uuid[]) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.friend_groups where id=p_group and owner=p_user for update;
 if not found then raise exception 'Group not found' using errcode='P0002'; end if;
 delete from public.friend_group_members where group_id=p_group and user_id<>all(p_members);
 insert into public.friend_group_members(group_id,user_id) select p_group,m from unnest(p_members) m on conflict do nothing;
end $$;

-- Invites the members of the host's group who are still friends and not already seated. Returns how many.
create function public.invite_group(p_table uuid,p_group uuid,p_user uuid) returns int
language plpgsql security definer set search_path='' as $$
declare n int;
begin
 if not exists(select 1 from public.tables where id=p_table and host=p_user and status='open') then
  raise exception 'Only the host of an open table can invite' using errcode='42501';
 end if;
 if not exists(select 1 from public.friend_groups where id=p_group and owner=p_user) then
  raise exception 'Group not found' using errcode='P0002';
 end if;
 insert into public.table_invites(table_id,user_id,invited_by)
 select p_table,m.user_id,p_user from public.friend_group_members m
 where m.group_id=p_group
  and not exists(select 1 from public.seats s where s.table_id=p_table and s.user_id=m.user_id)
  and exists(select 1 from public.friendships f where f.status='accepted'
   and ((f.requester=p_user and f.addressee=m.user_id) or (f.addressee=p_user and f.requester=m.user_id)))
 on conflict do nothing;
 get diagnostics n=row_count;
 return n;
end $$;

-- Open tables the player was invited to and has not sat down at, newest first.
create function public.my_invites(p_user uuid)
returns table(code text,"hostName" text,"hostSeed" text,seated int,"invitedAt" timestamptz)
language sql stable security definer set search_path='' as $$
 select t.code,p.display_name,p.avatar_seed,
  (select count(*)::int from public.seats s where s.table_id=t.id and (s.user_id is not null or s.bot is not null)),
  i.created_at
 from public.table_invites i join public.tables t on t.id=i.table_id join public.profiles p on p.id=i.invited_by
 where i.user_id=p_user and t.status='open'
  and not exists(select 1 from public.seats s where s.table_id=t.id and s.user_id=p_user)
 order by i.created_at desc limit 10;
$$;

revoke all on function public.check_friend_group(),public.check_friend_group_member(),public.drop_unfriended_members(),
 public.set_friend_group_members(uuid,uuid,uuid[]),public.invite_group(uuid,uuid,uuid),public.my_invites(uuid) from public,anon,authenticated;
grant execute on function public.set_friend_group_members(uuid,uuid,uuid[]),public.invite_group(uuid,uuid,uuid),public.my_invites(uuid) to service_role;
commit;
