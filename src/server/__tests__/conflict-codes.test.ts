import { readdirSync, readFileSync } from "node:fs";
import { expect, it } from "vitest";

// The database API retries 40001 (serialization_failure), so a logical conflict raised with it is
// replayed until the upstream timeout. Only the last definition of each function is live.
const dir = "supabase/migrations";
const latest = new Map<string, string>();
for (const file of readdirSync(dir).filter(f => f.endsWith(".sql")).sort()) {
  const sql = readFileSync(`${dir}/${file}`, "utf8");
  for (const match of sql.matchAll(/create (?:or replace )?function public\.(\w+)[\s\S]*?\$\$[\s\S]*?\$\$/gi)) {
    latest.set(match[1], match[0]);
  }
}

it("finds the functions that used to raise 40001", () => {
  for (const name of ["commit_game_action", "commit_bot_action", "control_table", "stand_in", "rematch_game", "start_game"]) {
    expect(latest.has(name), name).toBe(true);
  }
});

it("raises no logical conflict as 40001 in any live function", () => {
  const offenders = [...latest].filter(([, body]) => /errcode\s*=\s*'40001'/.test(body)).map(([name]) => name);
  expect(offenders).toEqual([]);
});

it("raises stale revisions as PT409 with the existing messages", () => {
  expect(latest.get("commit_game_action")).toContain("'Game changed; refresh and retry' using errcode='PT409'");
  expect(latest.get("commit_game_action")).toContain("'Table is not playing this game' using errcode='PT409'");
  expect(latest.get("rematch_game")).toContain("'Table changed; refresh and retry' using errcode='PT409'");
  expect(latest.get("stand_in")).toContain("'Table is not playing' using errcode='PT409'");
});
