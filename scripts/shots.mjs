// Screenshot lab positions with headless Chrome and write a contact sheet.
// Usage: node scripts/shots.mjs [--base http://localhost:3000] [--size 390x844,1440x900] [--only bid-stuck,play-must-trump]
//        [--url "/dev/lab?spec=..."] [--out .dev/shots]
// Needs `pnpm dev` running. Bots are paused so each picture is the exact position.
import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, i, all) => (arg.startsWith("--") ? [...pairs, [arg.slice(2), all[i + 1]]] : pairs), []));
const base = args.base ?? "http://localhost:3000";
const sizes = (args.size ?? "390x844").split(",").map(s => s.split("x").map(Number));
const out = resolve(args.out ?? ".dev/shots");
const chrome = process.env.CHROME ?? "google-chrome";
mkdirSync(out, { recursive: true });

// Presets are TypeScript; read their ids, groups and titles straight from the source.
const source = readFileSync("src/engine/scenarios.ts", "utf8");
const presets = [...source.matchAll(/\{ id: '([\w-]+)', group: '([^']+)', title: '([^']+)', note: '([^']+)'/g)]
  .map(([, id, group, title, note]) => ({ id, group, title, note, path: `/dev/lab?preset=${id}&chrome=0&run=0` }));
const only = args.only?.split(",");
const targets = args.url ? [{ id: "custom", group: "Custom", title: args.url, note: "", path: args.url }]
  : presets.filter(p => !only || only.includes(p.id));
if (!targets.length) { console.error("Nothing to shoot. Preset ids:", presets.map(p => p.id).join(" ")); process.exit(1); }

const jobs = targets.flatMap(t => sizes.map(([w, h]) => ({ ...t, w, h, file: `${t.id}-${w}x${h}.png` })));
let failed = 0;
async function shoot(job) {
  try {
    await run(chrome, ["--headless", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--virtual-time-budget=6000",
      `--window-size=${job.w},${job.h}`, `--screenshot=${join(out, job.file)}`, base + job.path], { timeout: 60000 });
    process.stdout.write(".");
  } catch (e) { failed++; console.error(`\n${job.file}: ${e.message.split("\n")[0]}`); }
}
for (let i = 0; i < jobs.length; i += 4) await Promise.all(jobs.slice(i, i + 4).map(shoot));

const esc = s => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const groups = [...new Set(jobs.map(j => j.group))];
writeFileSync(join(out, "index.html"), `<!doctype html><meta charset="utf-8"><title>Meld lab shots</title>
<style>body{font:14px system-ui;background:#2a0f13;color:#f5efe3;margin:24px}h2{font-weight:600;margin:28px 0 8px}
.row{display:flex;flex-wrap:wrap;gap:18px}figure{margin:0;width:min(${Math.max(...sizes.map(([w]) => w)) / 2}px,100%)}
img{width:100%;border-radius:8px;display:block}figcaption{margin-top:6px}small{color:#cbbfae;display:block}a{color:#d6a64a}</style>
<h1>Meld lab, ${new Date().toLocaleString()}</h1>
${groups.map(g => `<h2>${esc(g)}</h2><div class="row">${jobs.filter(j => j.group === g).map(j =>
  `<figure><a href="${esc(base + j.path.replace("&chrome=0", ""))}"><img src="${j.file}" loading="lazy" alt=""></a><figcaption>${esc(j.title)} <small>${j.w}x${j.h} · ${esc(j.note)}</small></figcaption></figure>`).join("")}</div>`).join("")}`);
console.log(`\n${jobs.length - failed}/${jobs.length} shots in ${out}; open ${join(out, "index.html")}`);
process.exit(failed ? 1 : 0);
