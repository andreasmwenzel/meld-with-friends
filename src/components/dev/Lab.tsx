"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { viewFor, type Action, type GameState, type SeatIndex } from "@/engine";
import { buildScenario, checkState, SEATS, type ScenarioSpec } from "@/engine/scenario";
import { PRESETS } from "@/engine/scenarios";
import { Game } from "@/components/table/Game";
import type { Snapshot } from "@/components/table/types";
import { decodeSpec, encodeSpec, labStore, parseImport, type LabSnapshot } from "./labStore";
import { LabPanel } from "./LabPanel";

const CODE = "LAB000";
const NAMES = ["South", "West", "North", "East"] as const;

function snapshotFor(s: LabSnapshot, rules: GameState["rules"]): Snapshot {
  return {
    table: { id: "lab", code: CODE, host: `lab${s.view}`, status: "playing", rules: { ...rules } },
    seats: SEATS.map(seat => s.bots.includes(seat)
      ? { seat, user_id: null, profile: null, bot: `${NAMES[seat]} bot` }
      : { seat, user_id: `lab${seat}`, bot: null, profile: { id: `lab${seat}`, handle: NAMES[seat].toLowerCase(), display_name: NAMES[seat], avatar_seed: NAMES[seat] } }),
    offers: [], mySeat: s.view, ready: s.flags.ready,
    paused: s.flags.paused ? { by: `lab${s.view}`, name: NAMES[s.view], reason: "Paused from the lab", at: new Date(0).toISOString() } : null,
  };
}


/** Apply the URL: ?preset=, ?spec=, ?state= pick the position; ?seat=, ?bots=, ?run=, ?speed= tune it. */
async function boot(qs: URLSearchParams) {
  const seat = qs.has("seat") ? (Number(qs.get("seat")) as SeatIndex) : undefined;
  if (qs.get("preset")) labStore.loadPreset(qs.get("preset")!, seat);
  else if (qs.get("spec")) labStore.loadSpec(decodeSpec(qs.get("spec")!), undefined, seat !== undefined ? { view: seat } : {});
  else if (qs.get("state")) {
    const name = qs.get("state")!;
    const res = await fetch(`/dev/states?name=${encodeURIComponent(name)}`);
    if (!res.ok) labStore.clearError();
    const parsed = parseImport(await res.json());
    labStore.load(parsed.base, parsed.actions, { kind: "import", name }, { notes: [parsed.note], ...(seat !== undefined ? { view: seat } : {}) });
  } else if (!labStore.restore()) labStore.loadPreset("play-lead");
  if (seat !== undefined && labStore.get().view !== seat) labStore.setView(seat);
  const bots = qs.get("bots");
  if (bots !== null) {
    const view = labStore.get().view;
    const wanted = bots === "all" ? SEATS.filter(s => s !== view) : bots === "none" ? [] : [...bots].map(Number).filter(s => s !== view) as SeatIndex[];
    for (const s of SEATS) if (labStore.get().bots.includes(s) !== wanted.includes(s)) labStore.toggleBot(s);
  }
  if (qs.get("run") === "0") labStore.setRunning(false);
  if (qs.get("speed")) labStore.setSpeed(Number(qs.get("speed")));
}

/** Console handle for agents and humans: `meld.load("hand-set")`, `meld.act({...})`, `meld.view(1)`. */
function exposeConsole() {
  Object.assign(window, {
    meld: {
      store: labStore,
      get state() { return labStore.state; },
      view: (seat?: SeatIndex) => viewFor(labStore.state, seat ?? labStore.get().view),
      act: (action: Action) => labStore.act(action),
      load: (what: string | ScenarioSpec) => typeof what === "string" ? labStore.loadPreset(what) : labStore.loadSpec(what),
      build: buildScenario,
      check: () => checkState(labStore.state),
      presets: PRESETS.map(p => p.id),
      step: () => labStore.step(),
      undo: labStore.undo, redo: labStore.redo,
      goto: (i: number) => labStore.goto(i),
      seat: (s: SeatIndex) => labStore.setView(s),
      spec: encodeSpec,
    },
  });
}

export function Lab() {
  const [ready, setReady] = useState(false);
  const [chrome, setChrome] = useState(true);
  const snap = useSyncExternalStore(labStore?.subscribe ?? (() => () => {}), () => labStore?.get(), () => null);

  useEffect(() => {
    const real = window.fetch;
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!url.includes(`/api/tables/${CODE}`)) return real.call(window, input, init);
      const s = labStore.get();
      const path = url.slice(url.indexOf(CODE) + CODE.length);
      if (path === "" || path === "?") return Response.json(snapshotFor(s, labStore.state.rules));
      if (path === "/view") return Response.json({ ...viewFor(labStore.state, s.view), ready: s.flags.ready });
      if (path === "/tick") return Response.json({ acted: false, rev: labStore.state.rev, delayMs: s.speed });
      if (path === "/ready") { labStore.setFlags({ ready: [...new Set([...s.flags.ready, s.view])] }); return Response.json({ ok: true }); }
      if (path === "/pause") { labStore.setFlags({ paused: true }); return Response.json({ ok: true }); }
      if (path === "/resume") { labStore.setFlags({ paused: false }); return Response.json({ ok: true }); }
      if (path === "/act") {
        try {
          const { action } = JSON.parse(String(init?.body)) as { action: Action };
          labStore.act({ ...action, seat: s.view } as Action);
          return Response.json(viewFor(labStore.state, s.view));
        } catch (e) { return Response.json({ error: (e as Error).message }, { status: 422 }); }
      }
      return Response.json({ error: "Not available in the lab." }, { status: 400 });
    };
    const qs = new URLSearchParams(window.location.search);
    setChrome(qs.get("chrome") !== "0"); // eslint-disable-line react-hooks/set-state-in-effect -- read once from the URL on mount
    exposeConsole();
    void boot(qs).finally(() => { setReady(true); labStore.kick(); });
    return () => { window.fetch = real; };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select")) return;
      if (e.key === "[") labStore.undo();
      else if (e.key === "]") labStore.redo();
      else if (e.key === ".") labStore.step();
      else if (e.key === "\\") labStore.setRunning(!labStore.get().running);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!ready || !snap) return <div className="min-h-[60vh]" />;
  const state = labStore.state;
  const table = snapshotFor(snap, state.rules);
  const me = table.seats[snap.view].profile!;
  return (
    <div className={`flex h-dvh flex-col overflow-hidden ${chrome ? "lg:pr-[360px]" : ""}`}>
      <Game key={`${snap.epoch}:${snap.view}:${snap.bots.join("")}`} local={snap.flags.local} code={CODE} me={me} snap={table} rev={state.rev}
        connection={snap.flags.reconnecting ? "reconnecting" : "ok"} onTableChange={() => {}} />
      {chrome ? <LabPanel snap={snap} state={state} /> : <style>{"nextjs-portal{display:none}"}</style>}
    </div>
  );
}
