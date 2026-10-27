-- Handles are two words, like copper_heron, instead of player, player1, player2 or the start of an email.
begin;

-- An unused adjective_noun handle. About ten thousand pairs; after many collisions a two-digit suffix
-- keeps it unique. Callers still insert with a conflict check, since another session can take it first.
create or replace function public.word_handle() returns text language plpgsql volatile set search_path = '' as $$
declare
  adjectives constant text[] := array[
    'amber','ashen','autumn','bold','brave','breezy','bright','brisk','bronze','calm',
    'candid','clever','cobalt','copper','cosy','crimson','crisp','curious','dapper','daring',
    'dusky','eager','early','easy','fabled','fair','fancy','fleet','floral','frosty',
    'gentle','gilded','glad','golden','grand','hardy','hazel','honest','humble','idle',
    'ivory','jade','jolly','keen','kind','lively','lucky','lunar','mellow','merry',
    'mighty','misty','modest','mossy','nimble','noble','oaken','olive','patient','peppy',
    'plucky','polite','proud','quick','quiet','rapid','rosy','royal','rustic','sandy',
    'scarlet','shady','sharp','silver','sleepy','smooth','snowy','solar','spry','starry',
    'steady','stormy','sunny','swift','tidy','topaz','tranquil','velvet','vivid','wandering',
    'warm','wavy','wild','windy','wise','witty','woolly','young','zesty','zippy'];
  nouns constant text[] := array[
    'acorn','badger','beacon','bear','beaver','birch','bison','bluejay','bramble','brook',
    'canyon','cardinal','cedar','clover','comet','coral','cougar','crane','creek','crow',
    'cypress','dahlia','deer','dove','dune','eagle','elk','ember','falcon','fern',
    'finch','fjord','fox','gecko','glacier','grove','gull','harbor','hare','hawk',
    'heron','hollow','ibis','island','jackal','kestrel','kite','lark','lantern','lynx',
    'maple','marmot','meadow','mesa','minnow','moose','moth','newt','oak','orchid',
    'osprey','otter','owl','panda','pebble','pelican','pine','plover','pony','puffin',
    'quail','raven','reef','ridge','river','robin','rook','sparrow','spruce','stag',
    'starling','stoat','swan','thistle','thrush','tiger','trout','tulip','valley','walrus',
    'warbler','willow','wolf','wombat','wren','yak','yarrow','zebra','zephyr','summit'];
  candidate text;
  tries integer := 0;
begin
  loop
    candidate := adjectives[1 + floor(random() * array_length(adjectives, 1))::int] || '_'
      || nouns[1 + floor(random() * array_length(nouns, 1))::int]
      || case when tries >= 20 then '_' || (10 + floor(random() * 90)::int)::text else '' end;
    if not exists (select 1 from public.profiles where handle = candidate) then return candidate; end if;
    tries := tries + 1;
  end loop;
end $$;

-- New accounts, guests included, get a word handle. The display name still comes from the sign-up.
create or replace function public.create_profile() returns trigger language plpgsql security definer set search_path = '' as $$
declare base text;
begin
  base := left(regexp_replace(lower(split_part(coalesce(new.email,'player'), '@', 1)), '[^a-z0-9_]', '', 'g'), 24);
  if length(base) < 3 then base := 'player'; end if;
  loop
    insert into public.profiles(id,handle,display_name) values(new.id,public.word_handle(),left(coalesce(new.raw_user_meta_data->>'full_name',base),80)) on conflict(handle) do nothing;
    if found then return new; end if;
  end loop;
end $$;

-- Gives the player a fresh word handle and returns it. Friendships and seats key on the user id, so
-- nothing else changes.
create or replace function public.regenerate_handle(p_user uuid) returns text language plpgsql security definer set search_path = '' as $$
declare candidate text;
begin
  loop
    candidate := public.word_handle();
    begin
      update public.profiles set handle = candidate where id = p_user;
      if not found then raise exception 'No profile for this user' using errcode = 'P0002'; end if;
      return candidate;
    exception when unique_violation then
      null; -- taken between the check and the update; draw again
    end;
  end loop;
end $$;

revoke all on function public.word_handle(), public.create_profile(), public.regenerate_handle(uuid) from public, anon, authenticated;
grant execute on function public.regenerate_handle(uuid) to service_role;

-- Everyone still on an automatic player, player1, player2 handle gets a word handle.
do $$
declare p record;
begin
  for p in select id from public.profiles where handle ~ '^player[0-9]*$' loop
    perform public.regenerate_handle(p.id);
  end loop;
end $$;

commit;
