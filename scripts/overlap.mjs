// Check that no control ever lies on a hand: every lab preset, at phone, sideways-phone, tablet and desktop sizes,
// with table talk on, in the hand-end "look at the table" view, and with the talk popover open.
// Usage: node scripts/overlap.mjs [--base http://localhost:3000] [--only hand-made,play-lead] [--size 390x844,1280x800]
//        [--url "/dev/lab?spec=...&chrome=0&run=0"] [--shots .dev/shots/overlap] [--jobs 6] [--verbose]
// Needs `pnpm dev` running. Exits 1 and lists preset / size / state / control x hand for every overlap.
// What counts as a hand, a control and an intended overlap: scripts/overlap-geometry.mjs (ALLOW) and docs/DEV_TOOLS.md.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { findOverlaps } from "./overlap-geometry.mjs";

const argv = process.argv.slice(2);
const args = Object.fromEntries(argv.reduce((pairs, arg, i, all) => (arg.startsWith("--") ? [...pairs, [arg.slice(2), all[i + 1]?.startsWith("--") ? "1" : all[i + 1] ?? "1"]] : pairs), []));
const base = args.base ?? "http://localhost:3000";
const SIZES = "360x640,375x667,390x844,393x852,414x896,430x932,844x390,932x430,768x1024,1280x800";
const sizes = (args.size ?? SIZES).split(",").map((s) => s.split("x").map(Number));
const shots = args.shots ? resolve(args.shots) : null;
const parallel = Number(args.jobs ?? 6);
const verbose = !!args.verbose;
const chrome = process.env.CHROME ?? "google-chrome";
if (shots) mkdirSync(shots, { recursive: true });

const source = readFileSync("src/engine/scenarios.ts", "utf8");
const presets = [...source.matchAll(/\{ id: '([\w-]+)', group: '([^']+)'/g)].map(([, id]) => ({ id, path: `/dev/lab?preset=${id}&chrome=0&run=0` }));
const only = args.only?.split(",");
const targets = args.url ? [{ id: "custom", path: args.url }] : presets.filter((p) => !only || only.includes(p.id));
if (!targets.length) { console.error("Nothing to check. Preset ids:", presets.map((p) => p.id).join(" ")); process.exit(2); }
const withTalk = (path) => `${path}${path.includes("?") ? "&" : "?"}chat=1&unread=3`;

// ---- a small Chrome DevTools Protocol client over one browser WebSocket (Node's built-in WebSocket) ----
const profile = mkdtempSync(join(tmpdir(), "meld-overlap-"));
const proc = spawn(chrome, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run",
  "--no-default-browser-check", "--disable-gpu", "--hide-scrollbars", "--mute-audio",
  // Pages run side by side; background ones must still lay out, run ResizeObserver and timers as a visible one does.
  "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
const wsUrl = await new Promise((ok, fail) => {
  let err = "";
  const timer = setTimeout(() => fail(new Error(`Chrome did not start:\n${err}`)), 20000);
  proc.stderr.on("data", (d) => {
    err += d;
    const m = /DevTools listening on (ws:\/\/\S+)/.exec(err);
    if (m) { clearTimeout(timer); ok(m[1]); }
  });
  proc.on("exit", (code) => fail(new Error(`Chrome exited (${code}):\n${err}`)));
});
const ws = new WebSocket(wsUrl);
await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail; });
let nextId = 1;
const pending = new Map();
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  const p = msg.id && pending.get(msg.id);
  if (!p) return;
  pending.delete(msg.id);
  if (msg.error) p.fail(new Error(`${p.method}: ${msg.error.message}`)); else p.ok(msg.result);
};
const send = (method, params = {}, sessionId) => new Promise((ok, fail) => {
  const id = nextId++;
  pending.set(id, { ok, fail, method });
  ws.send(JSON.stringify({ id, method, params, sessionId }));
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  try { ws.close(); } catch {}
  proc.kill();
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}
process.on("SIGINT", () => { cleanup(); process.exit(130); });

// ---- what the page reports: every hand's cards and every control, as boxes in CSS pixels ----
const MEASURE = `(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (el.checkVisibility?.({ opacityProperty: true, visibilityProperty: true }) ?? true); };
  const box = (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
  // What can show of an element: the screen, cut down by every ancestor that hides its overflow (not the ones that scroll).
  const clipOf = (el) => {
    let x0 = 0, y0 = 0, x1 = innerWidth, y1 = innerHeight;
    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.position === "fixed") break;
      if (cs.display === "contents") continue;
      if (![cs.overflowX, cs.overflowY].some((o) => o === "hidden" || o === "clip")) continue;
      const r = a.getBoundingClientRect();
      x0 = Math.max(x0, r.left); y0 = Math.max(y0, r.top); x1 = Math.min(x1, r.right); y1 = Math.min(y1, r.bottom);
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  };
  const hands = [...document.querySelectorAll("[data-hand]")].filter(vis).map((h) => ({
    hand: h.dataset.hand,
    scrolls: !!h.closest(".hand-scroll"),
    clip: clipOf(h),
    cards: [...h.querySelectorAll('svg[viewBox="0 0 100 140"]')].filter(vis).map((c) => ({ ...box(c), label: c.getAttribute("aria-label") || "back" })),
  }));
  // The trick and the meld on the cloth: not a hand, but no hand may lie under or over them either.
  const table = [...document.querySelectorAll('.board-centre svg[viewBox="0 0 100 140"]')].filter((c) => vis(c) && !c.closest("[data-hand]"));
  if (table.length) hands.push({ hand: "table", scrolls: false, cards: table.map((c) => ({ ...box(c), label: c.getAttribute("aria-label") || "back" })) });
  const overlays = [];
  // What lies on top of a control: sample a few points inside it and see which other control the page hits there.
  const coveredBy = (el) => {
    const r = el.getBoundingClientRect(), by = new Set();
    for (const [fx, fy] of [[.5, .5], [.25, .3], [.75, .3], [.25, .7], [.75, .7]]) {
      const x = r.left + r.width * fx, y = r.top + r.height * fy;
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
      const hit = document.elementFromPoint(x, y);
      if (!hit || el.contains(hit)) continue;
      const other = hit.closest("[data-overlay]");
      if (other && !other.contains(el)) by.add(other.dataset.overlay);
    }
    return [...by];
  };
  for (const el of document.querySelectorAll("[data-overlay]")) if (vis(el)) overlays.push({ name: el.dataset.overlay, ...box(el), coveredBy: coveredBy(el), clip: clipOf(el) });
  for (const zone of document.querySelectorAll("[data-overlay-zone]")) {
    for (const el of zone.querySelectorAll("button, a[href], input, select, textarea, [role=button]")) {
      if (!vis(el) || el.closest("[data-overlay]") || el.closest("[data-hand]")) continue;
      const text = (el.getAttribute("aria-label") || el.textContent || el.tagName).replace(/\\s+/g, " ").trim().slice(0, 28);
      overlays.push({ name: zone.dataset.overlayZone + ": " + text, ...box(el), coveredBy: coveredBy(el), clip: zone.matches(".board-action") && getComputedStyle(zone).overflowY === "auto" ? undefined : clipOf(el) });
    }
  }
  // Seat plates with their turn ring (2px outside the plate): they must show whole.
  const plates = [...document.querySelectorAll("[data-seat-plate]")].filter(vis).map((el) => {
    const b = box(el);
    return { name: "seat " + el.dataset.seatPlate, x: b.x - 2, y: b.y - 2, w: b.w + 4, h: b.h + 4, clip: clipOf(el) };
  });
  return { vw: innerWidth, vh: innerHeight, hands, overlays, plates, modal: !!document.querySelector("[role=dialog][aria-modal=true]") };
})()`;

async function job(target, [w, h]) {
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const cmd = (m, p) => send(m, p, sessionId);
  const evaluate = async (expression) => (await cmd("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.value;
  const results = [];
  try {
    await cmd("Page.enable");
    await cmd("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: Math.min(w, h) < 600 });
    // Settled positions only: motion off skips the deal and the fold, so each box is where it comes to rest.
    await cmd("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await cmd("Page.navigate", { url: base + withTalk(target.path) });
    const t0 = Date.now();
    while (!(await evaluate(`document.readyState === "complete" && !!document.querySelector("[data-hand]") && !!document.querySelector("[data-overlay=chat]")`))) {
      if (Date.now() - t0 > 45000) throw new Error("the table did not render (no [data-hand] or chat button)");
      await sleep(250);
    }
    await sleep(900);
    const look = async (state) => {
      // Wait for the layout to come to rest: the same reading for 1.5s. A claimed hand, for one, shows the claim for a
      // moment on timers (Claim.tsx) before the hands are laid out face up; motion settings do not shorten that.
      let snap = null;
      for (let t = 0, last = "", same = 0; t < 40 && same < 6; t++) {
        await sleep(250);
        // Headless Chrome may not draw a frame on its own, and ResizeObserver (the board's fit) runs only when one is
        // drawn; a throwaway screenshot forces one, so what is measured is what the screen would show. (A clipped 1px
        // one is cheaper, but leaves the next full screenshot missing composited layers such as the trick cards.)
        await cmd("Page.captureScreenshot", { format: "jpeg", quality: 1 });
        snap = await evaluate(MEASURE);
        const now = JSON.stringify([snap.hands, snap.plates, snap.overlays.map((o) => [o.x, o.y]), snap.modal]);
        same = now === last ? same + 1 : 0;
        last = now;
      }
      const file = shots ? `${target.id}-${w}x${h}-${state}.png` : null;
      if (file) writeFileSync(join(shots, file), Buffer.from((await cmd("Page.captureScreenshot", { format: "png" })).data, "base64"));
      if (snap.modal) { results.push({ state, skipped: "result sheet up: the board is behind its scrim", snap }); return; }
      results.push({ state, ...findOverlaps(snap), snap, file });
    };
    const click = (selector) => evaluate(`(() => { const el = ${selector}; if (!el) return false; el.click(); return true; })()`);
    const lookButton = `[...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Look at the table")`;
    const chatButton = `document.querySelector("[data-overlay=chat]")`;

    await look("table");
    // Hand over: the sheet is modal; "Look at the table" shows every hand face up with the peek buttons along the bottom.
    if (results.at(-1).skipped && (await click(lookButton))) await look("peek");
    if (await click(chatButton)) {
      await look(results.at(-1).state === "peek" ? "peek+talk" : "talk");
      await click(chatButton);
    }
  } finally {
    await send("Target.closeTarget", { targetId }).catch(() => {});
  }
  return results;
}

// Compile the lab once before the parallel run, so the first jobs do not time out waiting for the dev server.
await fetch(base + "/dev/lab?chrome=0&run=0").catch(() => { console.error(`No dev server at ${base}; start pnpm dev first.`); cleanup(); process.exit(2); });

const jobs = targets.flatMap((t) => sizes.map((s) => ({ t, s })));
const report = [];
let errors = 0;
try {
  for (let i = 0; i < jobs.length; i += parallel) {
    await Promise.all(jobs.slice(i, i + parallel).map(async ({ t, s }) => {
      try {
        const results = await job(t, s);
        report.push({ id: t.id, size: `${s[0]}x${s[1]}`, results });
        process.stdout.write(results.some((r) => r.failures?.length) ? "x" : ".");
      } catch (e) {
        errors++;
        report.push({ id: t.id, size: `${s[0]}x${s[1]}`, error: e.message });
        process.stdout.write("E");
      }
    }));
  }
} finally { cleanup(); }
process.stdout.write("\n");

const order = (a, b) => targets.findIndex((t) => t.id === a.id) - targets.findIndex((t) => t.id === b.id) || sizes.findIndex(([w, h]) => `${w}x${h}` === a.size) - sizes.findIndex(([w, h]) => `${w}x${h}` === b.size);
report.sort(order);
let failures = 0, states = 0, allowedHits = 0;
const byPreset = new Map();
for (const r of report) {
  if (r.error) { console.log(`${r.id} ${r.size}: ERROR ${r.error}`); continue; }
  for (const s of r.results) {
    if (s.skipped) continue;
    states++;
    allowedHits += s.allowed.length;
    if (verbose) for (const a of s.allowed) console.log(`  allowed  ${r.id} ${r.size} ${s.state}: ${a.a} x ${a.b} (${a.cards} cards): ${a.why}`);
    for (const f of s.failures) {
      failures++;
      byPreset.set(r.id, (byPreset.get(r.id) ?? 0) + 1);
      const what = f.kind === "control" ? `${f.a} on ${f.b} hand` : f.kind === "hands" ? `${f.a} hand on ${f.b} hand`
        : f.kind === "covered" ? `${f.b} covered by ${f.a}` : f.kind === "edge" ? `${f.b} cut off by the screen edge or a clipping box`
        : `${f.b} hand cut off by the screen edge or a clipping box`;
      const size = f.kind === "control" || f.kind === "hands" ? ` (${f.cards} card${f.cards === 1 ? "" : "s"}, up to ${f.area}px²)` : f.kind === "clipped" ? ` (${f.cards} card${f.cards === 1 ? "" : "s"})` : "";
      console.log(`${r.id} ${r.size} ${s.state}: ${what}${size}${s.file ? `  ${s.file}` : ""}`);
    }
  }
}
writeFileSync(join(tmpdir(), "meld-overlap-report.json"), JSON.stringify(report, null, 1));
console.log(`\n${states} screens checked over ${targets.length} position${targets.length === 1 ? "" : "s"} x ${sizes.length} size${sizes.length === 1 ? "" : "s"}: `
  + `${failures} overlap${failures === 1 ? "" : "s"}${failures ? ` (${[...byPreset].map(([id, n]) => `${id} ${n}`).join(", ")})` : ""}, `
  + `${allowedHits} allowed${errors ? `, ${errors} error${errors === 1 ? "" : "s"}` : ""}. Boxes: ${join(tmpdir(), "meld-overlap-report.json")}`);
process.exit(failures || errors ? 1 : 0);
