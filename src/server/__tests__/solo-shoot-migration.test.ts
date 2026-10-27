import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('migrates stored shoot preferences while preserving game states and action logs', () => {
  const sql = readFileSync('supabase/migrations/0019_solo_shoot_rules.sql', 'utf8');
  expect(sql).toMatch(/create or replace function pg_temp\.solo_shoot_rules/i);
  expect(sql).toMatch(/r - 'shootPoints'/);
  expect(sql).toMatch(/r->>'shoot' in \('game', 'points'\)/);
  expect(sql).toContain('{"shoot":"on"}');
  expect(sql).toContain('update public.tables set rules');
  expect(sql).toContain('update public.profiles set default_rules');
  expect(sql).toContain('update public.app_settings set value');
  expect(sql).toContain("array['rules', 'default_rules', 'defaultRules']");
  expect(sql).not.toMatch(/update public\.(games|game_actions)\b/i);
});
