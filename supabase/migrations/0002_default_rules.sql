alter table public.profiles add column default_rules jsonb not null default '{}'::jsonb;
