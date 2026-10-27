import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/0020_word_handles.sql", "utf8");
const words = (name: string) => [...sql.match(new RegExp(`${name} constant text\\[\\] := array\\[([\\s\\S]*?)\\];`))![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

it("draws handles from two word lists that fit the handle format", () => {
  for (const list of [words("adjectives"), words("nouns")]) {
    expect(list.length).toBeGreaterThanOrEqual(100);
    expect(new Set(list).size).toBe(list.length);
    for (const w of list) expect(w).toMatch(/^[a-z]+$/);
  }
  const longest = Math.max(...words("adjectives").map((w) => w.length)) + 1 + Math.max(...words("nouns").map((w) => w.length)) + 3;
  expect(longest).toBeLessThanOrEqual(32);
});

it("gives new accounts word handles and only replaces automatic player handles", () => {
  expect(sql).toMatch(/create or replace function public\.create_profile\(\)[\s\S]*public\.word_handle\(\)/);
  expect(sql).toContain("where handle ~ '^player[0-9]*$'");
  expect(sql).toContain("grant execute on function public.regenerate_handle(uuid) to service_role;");
  expect(sql).toMatch(/revoke all on function [^;]*public\.regenerate_handle\(uuid\) from public, anon, authenticated;/);
});
