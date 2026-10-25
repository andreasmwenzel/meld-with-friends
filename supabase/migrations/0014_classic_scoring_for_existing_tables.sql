-- Tables created before modern scoring existed were set up in classic x10 points, often with partial
-- rule patches such as {"pace":"leisurely"}. Record the scale they were created with, so starting or
-- rematching one keeps playing to 1,500 instead of switching to modern defaults.
update public.tables set rules = rules || '{"scoring":"classic"}'::jsonb where not (rules ? 'scoring');
