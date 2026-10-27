-- Shooting now has one enabled rule. Keep games.state and action logs intact for legacy replay.
create or replace function pg_temp.solo_shoot_rules(r jsonb) returns jsonb
language sql immutable as $$
  select (r - 'shootPoints') || case when r->>'shoot' in ('game', 'points')
    then '{"shoot":"on"}'::jsonb else '{}'::jsonb end
    || case when not (r ? 'scoring') and jsonb_typeof(r->'shootPoints') = 'number'
      then '{"scoring":"classic"}'::jsonb else '{}'::jsonb end
$$;

update public.tables set rules = pg_temp.solo_shoot_rules(rules)
where rules ? 'shootPoints' or rules->>'shoot' in ('game', 'points');

update public.profiles set default_rules = pg_temp.solo_shoot_rules(default_rules)
where default_rules ? 'shootPoints' or default_rules->>'shoot' in ('game', 'points');

-- app_settings currently stores bots and limits. Also cover optional rule-default rows or fields
-- without adding a default or altering unrelated settings.
update public.app_settings set value = pg_temp.solo_shoot_rules(value)
where key in ('rules', 'default_rules', 'defaultRules') and jsonb_typeof(value) = 'object';

do $$
declare field text;
begin
  foreach field in array array['rules', 'default_rules', 'defaultRules'] loop
    update public.app_settings set value = jsonb_set(value, array[field], pg_temp.solo_shoot_rules(value->field))
    where jsonb_typeof(value->field) = 'object';
  end loop;
end $$;
