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
import { checkPresence, findOverlaps } from "./overlap-geometry.mjs";

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

// The presets as the app exports them (src/engine/scenarios.ts, served by the dev-only /dev/presets), so a change in
// how the file is written cannot drop positions. Each spec says what the page must show: the phase it stops in, whose
// turn it is, whether the hand ends (the result sheet) and whether passing is on.
const listed = await fetch(base + "/dev/presets").then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
  .catch((e) => { console.error(`Could not load the presets from ${base}/dev/presets (${e.message}); start pnpm dev first.`); process.exit(2); });
// A cross-check on the list: no fewer presets than entries that look like one in the source.
const inSource = (readFileSync("src/engine/scenarios.ts", "utf8").match(/^\s*\{\s*id:/gm) ?? []).length;
if (!Array.isArray(listed) || !listed.length || listed.length < inSource) {
  console.error(`/dev/presets gave ${Array.isArray(listed) ? listed.length : "no"} presets; scenarios.ts has ${inSource}.`);
  process.exit(2);
}
const presets = listed.map(({ id, spec, view }) => {
  const phase = spec.to ?? "bidding";
  return { id, path: `/dev/lab?preset=${id}&chrome=0&run=0`, phase, handEnd: phase === "hand_over" || phase === "game_over",
    passing: spec.rules?.passCount !== 0, myTurn: spec.turn == null ? null : spec.turn === view };
});
const only = args.only?.split(",");
const targets = args.url ? [{ id: "custom", path: args.url, phase: null, handEnd: null, passing: null, myTurn: null }] : presets.filter((p) => !only || only.includes(p.id));
if (!targets.length || (only && targets.length < only.length)) {
  console.error(`Unknown preset${only ? ` in ${only.filter((id) => !presets.some((p) => p.id === id)).join(", ")}` : ""}. Preset ids:`, presets.map((p) => p.id).join(" "));
  process.exit(2);
}
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
    declared: h.dataset.handCards == null ? null : Number(h.dataset.handCards),
    cards: [...h.querySelectorAll("[data-card]")].filter(vis).map((c) => ({ ...box(c), label: c.dataset.card })),
  }));
  // The trick and the meld on the cloth: not a hand, but no hand may lie under or over them either.
  const table = [...document.querySelectorAll(".board-centre [data-card]")].filter((c) => vis(c) && !c.closest("[data-hand]"));
  if (table.length) hands.push({ hand: "table", scrolls: false, cards: table.map((c) => ({ ...box(c), label: c.dataset.card })) });
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
  for (const el of document.querySelectorAll("[data-overlay]")) if (vis(el)) overlays.push({ name: el.dataset.overlay, ...box(el), coveredBy: coveredBy(el), clip: clipOf(el), own: el.dataset.ownCard ?? null });
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
  // Tap targets: how far a tap still reaches each control, probed from its middle outwards along both axes with
  // elementFromPoint, so padding and pseudo-elements that widen the hit area count and neighbours drawn on top do not.
  // With the talk popover open only its own controls are in reach; otherwise every control on the table.
  const label = (el) => el.dataset.overlay || (el.dataset.handCard && "card " + el.dataset.handCard) || (el.getAttribute("aria-label") || el.textContent || el.tagName).replace(/\\s+/g, " ").trim().slice(0, 28);
  const reach = (el) => {
    const r = el.getBoundingClientRect(), cy = r.top + r.height / 2;
    const on = (x, y) => { if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return false; const t = document.elementFromPoint(x, y); return !!t && (t === el || el.contains(t)); };
    // The middle of the part that shows (a card in a fan shows only a strip at its left).
    let a = -1, b = -1;
    for (let x = Math.floor(r.left); x <= r.right; x++) if (on(x, cy)) { if (a < 0) a = x; b = x; }
    if (a < 0) return { w: 0, h: 0 };
    const cx = (a + b) / 2;
    // What a tap lands on just past the reach, when that is inside the 44px the control should have: the reason it falls short.
    const by = new Set();
    const what = (x, y) => { const t = document.elementFromPoint(x, y); if (!t) return "the screen edge"; const c = t.closest("button, a, [data-hand], [data-overlay]") ?? t; return (c.dataset?.overlay || c.dataset?.hand || c.getAttribute?.("aria-label") || c.tagName.toLowerCase() + (typeof c.className === "string" && c.className ? "." + c.className.split(" ")[0] : "")).slice(0, 30); };
    const out = (dx, dy, max) => { let n = 0; while (n < max && on(cx + dx * (n + 1), cy + dy * (n + 1))) n++; if (n < 22) by.add(what(cx + dx * (n + 1), cy + dy * (n + 1))); return n; };
    const mx = r.width / 2 + 30, my = r.height / 2 + 30;
    const w = out(-1, 0, mx) + out(1, 0, mx) + 1, h = out(0, -1, my) + out(0, 1, my) + 1;
    return { w, h, by: w < 44 || h < 44 ? [...by] : [] };
  };
  const pop = document.querySelector("[data-overlay=chat-popover]:not([hidden])");
  const controls = [...document.querySelectorAll(".board :is(button, a[href], input, select, textarea, [role=button], [role=tab])")]
    .filter((el) => vis(el) && !el.closest("[inert]") && !el.disabled && (pop ? pop.contains(el) : !el.closest("[data-overlay=chat-popover]")))
    .map((el) => ({ name: label(el), card: el.hasAttribute("data-hand-card"), ...reach(el) }));
  const board = document.querySelector(".board[data-phase]");
  return { vw: innerWidth, vh: innerHeight, hands, overlays, plates, controls, modal: !!document.querySelector("[role=dialog][aria-modal=true]"),
    expected: board && board.dataset.hands != null ? board.dataset.hands.split(" ").filter(Boolean) : null, phase: board?.dataset.phase ?? null, sittingOut: board?.dataset.sittingOut ?? null,
    canPlay: !!board && board.hasAttribute("data-can-play"), claim: !!board && board.hasAttribute("data-claim") };
})()`;

async function job(target, [w, h]) {
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const cmd = (m, p) => send(m, p, sessionId);
  const evaluate = async (expression) => (await cmd("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.value;
  const results = [], problems = [];
  try {
    await cmd("Page.enable");
    const phone = Math.min(w, h) < 600;
    await cmd("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: phone });
    // Phones are touch screens (a coarse pointer), as the real ones are.
    if (phone) await cmd("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    // "Tap twice to play" on at every size (phones have it by default): the first tap lifts a card and shows the
    // Play button, which the armed screen measures.
    await cmd("Page.addScriptToEvaluateOnNewDocument", { source: `try { if (!localStorage.getItem("meld.cards")) localStorage.setItem("meld.cards", JSON.stringify({ v: 2, confirmPlay: true })); } catch {}` });
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
      if (snap.modal) { results.push({ state, skipped: "result sheet up: the board is behind its scrim", snap }); return snap; }
      const presence = checkPresence(snap, { faceUp: state.startsWith("peek") });
      results.push({ state, ...findOverlaps(snap), presence, snap, file });
      return snap;
    };
    const click = (selector) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`);
    const shown = (selector) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && el.checkVisibility(); })()`);
    // A screen that should be reachable and is not fails the run: a renamed button must not shrink the check silently.
    const expect = async (ok, what) => { if (!ok) problems.push(`${what}`); return ok; };
    const openTalk = async (state) => {
      if (!(await expect(await click("[data-overlay=chat]"), "talk button not found"))) return;
      await sleep(200);
      if (await expect(await shown("[data-overlay=chat-popover]"), `talk popover did not open (${state})`)) await look(state);
      await click("[data-overlay=chat]");
      await sleep(200);
      await expect(!(await shown("[data-overlay=chat-popover]")), `talk popover did not close (${state})`);
    };

    const first = await look("table");
    // The position the preset asks for: the phase, and in trick play whether it is your turn with a card to play.
    if (target.phase) await expect(first.phase === target.phase, `expected phase ${target.phase}, the board is in ${first.phase ?? "no phase (data-phase missing)"}`);
    if (target.phase === "playing" && target.myTurn != null) await expect(first.canPlay === target.myTurn, target.myTurn ? "expected your turn with a card to play" : "expected another seat's turn, but you can play");
    const handEnd = target.handEnd ?? ["hand_over", "game_over"].includes(first.phase);
    if (handEnd) {
      // Hand over: the sheet is modal; "Look at the table" shows every hand face up with the peek buttons along the bottom.
      await expect(first.modal, "result sheet did not open at hand end");
      if (await expect(await click("[data-action=look-at-table]"), "no \"Look at the table\" on the result sheet")) {
        await sleep(200);
        if (await expect(await shown("[data-action=back-to-result]"), "\"Look at the table\" did not show the table with \"Back to the result\"")) {
          const peek = await look("peek");
          await openTalk("peek+talk");
          // Passing on and no claim: the hands can be shown as dealt as well as after passing.
          if ((target.passing ?? true) && !peek.claim && (target.passing !== null || await shown("[data-reveal=dealt]"))) {
            if (await expect(await click("[data-reveal=dealt]"), "no \"As dealt\" toggle in the face-up view")) {
              await sleep(200);
              if (await expect(await evaluate(`document.querySelector("[data-reveal=dealt]")?.getAttribute("aria-pressed") === "true"`), "\"As dealt\" did not switch the hands")) await look("peek-dealt");
              await click("[data-reveal=atPlay]");
            }
          }
        }
      }
    } else {
      await expect(!first.modal, "result sheet up before the hand ended");
      await openTalk("talk");
      // Your turn in trick play: lift a playable card; the Play button rises out of the hand beside it.
      if (first.phase === "playing" && first.canPlay) {
        if (await expect(await click("[data-hand-card]:not([aria-disabled=true])"), "no playable card in your hand on your turn")) {
          await sleep(200);
          if (await expect(await shown("[data-overlay=play]"), "lifting a playable card did not show the Play button")) await look("armed");
        }
      }
    }
  } finally {
    await send("Target.closeTarget", { targetId }).catch(() => {});
  }
  return { results, problems };
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
        const { results, problems } = await job(t, s);
        report.push({ id: t.id, size: `${s[0]}x${s[1]}`, results, problems });
        process.stdout.write(problems.length || results.some((r) => r.failures?.length || r.presence?.length) ? "x" : ".");
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
let failures = 0, states = 0, allowedHits = 0, missing = 0;
const byPreset = new Map();
for (const r of report) {
  if (r.error) { console.log(`${r.id} ${r.size}: ERROR ${r.error}`); continue; }
  for (const p of r.problems) { missing++; console.log(`${r.id} ${r.size}: MISSING ${p}`); }
  for (const s of r.results) {
    if (s.skipped) continue;
    states++;
    allowedHits += s.allowed.length;
    for (const p of s.presence) { missing++; console.log(`${r.id} ${r.size} ${s.state}: MISSING ${p}${s.file ? `  ${s.file}` : ""}`); }
    if (verbose) for (const a of s.allowed) console.log(`  allowed  ${r.id} ${r.size} ${s.state}: ${a.a} x ${a.b} (${a.cards} cards): ${a.why}`);
    for (const f of s.failures) {
      failures++;
      byPreset.set(r.id, (byPreset.get(r.id) ?? 0) + 1);
      const what = f.kind === "control" ? `${f.a} on ${f.b} hand` : f.kind === "hands" ? `${f.a} hand on ${f.b} hand` : f.kind === "controls" ? `${f.a} on ${f.b}`
        : f.kind === "small" ? `"${f.b}" can be tapped over ${f.a}, under 44x44${f.by?.length ? ` (cut short by ${f.by.join(", ")})` : ""}` : f.kind === "covered" ? `${f.b} covered by ${f.a}` : f.kind === "edge" ? `${f.b} cut off by the screen edge or a clipping box`
        : `${f.b} hand cut off by the screen edge or a clipping box`;
      const size = f.kind === "controls" ? ` (${f.area}px²)` : f.kind === "control" || f.kind === "hands" ? ` (${f.cards} card${f.cards === 1 ? "" : "s"}, up to ${f.area}px²)` : f.kind === "clipped" ? ` (${f.cards} card${f.cards === 1 ? "" : "s"})` : "";
      console.log(`${r.id} ${r.size} ${s.state}: ${what}${size}${s.file ? `  ${s.file}` : ""}`);
    }
  }
}
writeFileSync(join(tmpdir(), "meld-overlap-report.json"), JSON.stringify(report, null, 1));
// Every position reaches at least two screens (the table or the face-up view, and the same with the talk open).
const floor = 2 * jobs.length;
const short = states < floor;
if (short) console.log(`Only ${states} screens checked; every position and size reaches at least 2, so expected ${floor} or more.`);
console.log(`\n${states} screens checked over ${targets.length} position${targets.length === 1 ? "" : "s"} x ${sizes.length} size${sizes.length === 1 ? "" : "s"}: `
  + `${failures} overlap${failures === 1 ? "" : "s"}${failures ? ` (${[...byPreset].map(([id, n]) => `${id} ${n}`).join(", ")})` : ""}, `
  + `${missing ? `${missing} missing, ` : ""}${allowedHits} allowed${errors ? `, ${errors} error${errors === 1 ? "" : "s"}` : ""}. Boxes: ${join(tmpdir(), "meld-overlap-report.json")}`);
process.exit(failures || missing || errors || short ? 1 : 0);
