// Copy a production game into the dev lab. Read-only: it only selects rows.
// Usage: node scripts/pull-game.mjs TABLECODE [name]   then open /dev/lab?state=<name>
// Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env.local. Writes .dev/states/<name>.json.
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const code = process.argv[2]?.toUpperCase();
if (!code) { console.error("Usage: node scripts/pull-game.mjs TABLECODE [name]"); process.exit(1); }
const name = process.argv[3] ?? `prod-${code.toLowerCase()}`;
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter(l => l.includes("=")).map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: table, error: tableError } = await db.from("tables").select("id,code,current_game_id,status").eq("code", code).maybeSingle();
if (tableError) throw tableError;
if (!table?.current_game_id) { console.error(`No table ${code} with a game`); process.exit(1); }
const { data: game, error: gameError } = await db.from("games").select("id,state,rev").eq("id", table.current_game_id).single();
if (gameError) throw gameError;
const actions = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await db.from("game_actions").select("action,rev").eq("game_id", game.id).order("rev").range(from, from + 999);
  if (error) throw error;
  actions.push(...data.map(row => row.action));
  if (data.length < 1000) break;
}
mkdirSync(".dev/states", { recursive: true });
writeFileSync(`.dev/states/${name}.json`, JSON.stringify({ state: game.state, actions, table: { code: table.code, status: table.status }, pulledAt: new Date().toISOString() }, null, 1));
console.log(`Saved ${code} (rev ${game.rev}, ${actions.length} actions, ${game.state.phase}) to .dev/states/${name}.json`);
console.log(`Open http://localhost:3000/dev/lab?state=${name}`);
