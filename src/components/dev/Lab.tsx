"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { viewFor, type Action, type GameState, type SeatIndex } from "@/engine";
import { buildScenario, checkState, SEATS, type ScenarioSpec } from "@/engine/scenario";
import { PRESETS } from "@/engine/scenarios";
import { Game } from "@/components/table/Game";
import type { ShownMessage, TableChat } from "@/components/table/ChatDock";
import type { Snapshot } from "@/components/table/types";
import { decodeSpec, encodeSpec, labStore, parseImport, type LabSnapshot } from "./labStore";
import { LabPanel } from "./LabPanel";
import { createLabBroadcast, LAB_GAME } from "./labBroadcast";

const CODE = "LAB000";
const NAMES = ["South", "West", "North", "East"] as const;
// Real bot names, so each bot has its table-talk voice and its player-menu tag as in a live game.
const BOT_NAMES = ["Pearl", "Hazel", "Mabel", "Gus"] as const;

function snapshotFor(s: LabSnapshot, rules: GameState["rules"], live = false): Snapshot {
  return {
    table: { id: "lab", code: CODE, host: `lab${s.view}`, status: "playing", rules: { ...rules }, ...(live ? { current_game_id: LAB_GAME } : {}) },
    seats: SEATS.map(seat => s.bots.includes(seat)
      ? { seat, user_id: null, profile: null, bot: BOT_NAMES[seat] }
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
    labStore.load(parsed.base, parsed.actions, { kind: "import", name }, { legacyShoots: parsed.legacyShoots, notes: [parsed.note], ...(seat !== undefined ? { view: seat } : {}) });
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

const SAMPLE_TALK: [SeatIndex, string][] = [
  [1, "Who dealt this mess?"],
  [2, "Partner, I have nothing. Good luck."],
  [3, "Nice pinochle last hand."],
  [1, "Ready when you are"],
  [2, "👍"],
];

/**
 * ?chat=1: a local stand-in for table talk, so the board's talk button and popover can be checked without a
 * Realtime channel. Sample messages from the other seats arrive unread (`?unread=N`, default 3); what you send
 * stays in the browser (`?chatlag=ms` holds it as sending first). `meld.say("text", seat)` posts a message from another seat.
 */
function useLabChat(enabled: boolean, view: SeatIndex): TableChat | undefined {
  const [messages, setMessages] = useState<ShownMessage[]>([]);
  const [unread, setUnread] = useState(0);
  const visible = useRef(false);
  useEffect(() => {
    if (!enabled) return;
    const n = Math.max(0, Math.min(SAMPLE_TALK.length, Number(new URLSearchParams(window.location.search).get("unread") ?? 3)));
    const others = SAMPLE_TALK.filter(([seat]) => seat !== view);
    const sample = others.map(([seat, text], i) => ({ id: `lab-${i}`, from: `lab${seat}`, name: NAMES[seat], text, at: i }));
    setMessages(sample); // eslint-disable-line react-hooks/set-state-in-effect -- seeds the sample talk once from the URL
    setUnread(Math.min(n, sample.length));
  }, [enabled, view]);
  const setVisible = useCallback((v: boolean) => { visible.current = v; if (v) setUnread(0); }, []);
  const add = useCallback((from: SeatIndex, text: string) => {
    setMessages((prev) => [...prev.slice(-99), { id: crypto.randomUUID(), from: `lab${from}`, name: NAMES[from], text: text.trim().slice(0, 300), at: Date.now() }]);
    if (from !== view && !visible.current) setUnread((u) => u + 1);
  }, [view]);
  // ?chatlag=ms: what you send shows as sending for that long, as it does while a live table's server answers.
  const send = useCallback(async (text: string) => {
    if (!text.trim()) return;
    const lag = Number(new URLSearchParams(window.location.search).get("chatlag") ?? 0);
    if (lag > 0) {
      const id = `pending-${crypto.randomUUID()}`;
      setMessages((prev) => [...prev.slice(-99), { id, from: `lab${view}`, name: NAMES[view], text: text.trim(), at: Date.now(), pending: true }]);
      await new Promise((r) => setTimeout(r, lag));
      setMessages((prev) => prev.filter((m) => m.id !== id));
    }
    add(view, text);
  }, [add, view]);
  useEffect(() => {
    if (!enabled) return;
    const meld = (window as unknown as { meld?: Record<string, unknown> }).meld;
    if (meld) meld.say = (text: string, seat: SeatIndex = ((view + 1) % 4) as SeatIndex) => add(seat, text);
  });
  return enabled ? { messages, unread, setVisible, send, me: `lab${view}` } : undefined;
}

export function Lab() {
  const [ready, setReady] = useState(false);
  // ?broadcast=1: game events reach the board as on a live table (see labBroadcast.ts); ?autoplay=1 plays the hand out.
  const [broadcast] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("broadcast") === "1" ? createLabBroadcast() : null);
  const [chrome, setChrome] = useState(true);
  const snap = useSyncExternalStore(labStore?.subscribe ?? (() => () => {}), () => labStore?.get(), () => null);
  const [talk] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("chat") === "1");
  const chat = useLabChat(talk, snap?.view ?? 0);

  useEffect(() => {
    const real = window.fetch;
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      // A friend request from a player's menu goes nowhere in the lab, but succeeds so the menu can show it.
      if (url.endsWith("/api/friends") && init?.method !== "GET" && init?.body) return Response.json({ ok: true }, { status: 201 });
      if (!url.includes(`/api/tables/${CODE}`)) return real.call(window, input, init);
      const s = labStore.get();
      const path = url.slice(url.indexOf(CODE) + CODE.length);
      if (path === "" || path === "?") return Response.json(snapshotFor(s, labStore.state.rules));
      if (path === "/view") return Response.json(broadcast ? broadcast.view(s.view, { ready: s.flags.ready }) : { ...viewFor(labStore.state, s.view), ready: s.flags.ready });
      if (path === "/tablemates") return Response.json(SEATS.filter(seat => seat !== s.view && !s.bots.includes(seat)).map(seat => ({ userId: `lab${seat}`, handle: NAMES[seat].toLowerCase(), displayName: NAMES[seat], status: "none" })));
      if (path === "/tick") return Response.json({ acted: false, rev: labStore.state.rev, delayMs: s.speed });
      if (path === "/ready") { labStore.setFlags({ ready: [...new Set([...s.flags.ready, s.view])] }); return Response.json({ ok: true }); }
      if (path === "/pause") { labStore.setFlags({ paused: true }); return Response.json({ ok: true }); }
      if (path === "/resume") { labStore.setFlags({ paused: false }); return Response.json({ ok: true }); }
      if (path === "/act") {
        try {
          const { action } = JSON.parse(String(init?.body)) as { action: Action };
          labStore.act({ ...action, seat: s.view } as Action);
          const view = viewFor(labStore.state, s.view);
          return Response.json(broadcast ? broadcast.withKey(view) : view);
        } catch (e) { return Response.json({ error: (e as Error).message }, { status: 422 }); }
      }
      return Response.json({ error: "Not available in the lab." }, { status: 400 });
    };
    const qs = new URLSearchParams(window.location.search);
    setChrome(qs.get("chrome") !== "0"); // eslint-disable-line react-hooks/set-state-in-effect -- read once from the URL on mount
    exposeConsole();
    // Strict Mode runs this effect twice: setup that finishes after cleanup must undo itself.
    let disposed = false;
    let autoplay: ReturnType<typeof setInterval> | undefined;
    let unsubscribe: (() => void) | undefined;
    void boot(qs).then(async () => {
      if (!broadcast || disposed) return;
      const stop = await broadcast.start();
      if (disposed) { stop(); return; }
      unsubscribe = stop;
      if (qs.get("autoplay") !== "1") return;
      // Every seat moves through the lab store, so each move reaches the board only as a broadcast.
      labStore.setRunning(false);
      autoplay = setInterval(() => {
        const phase = labStore.state.phase;
        if (phase === "hand_over" || phase === "game_over" || !labStore.step()) clearInterval(autoplay);
      }, labStore.get().speed);
    }).finally(() => { if (disposed) return; setReady(true); labStore.kick(); });
    return () => { disposed = true; window.fetch = real; clearInterval(autoplay); unsubscribe?.(); };
  }, [broadcast]);

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
  const table = snapshotFor(snap, state.rules, !!broadcast);
  const me = table.seats[snap.view].profile!;
  return (
    <div className={`flex h-dvh flex-col overflow-hidden ${chrome ? "lg:pr-[360px]" : ""}`}>
      <Game key={`${snap.epoch}:${snap.view}:${snap.bots.join("")}`} local={snap.flags.local} code={CODE} me={me} snap={table}
        {...broadcast ? { feed: broadcast.feed, inspect: broadcast.inspect } : { rev: state.rev }}
        connection={snap.flags.reconnecting ? "reconnecting" : "ok"} onTableChange={() => {}} chat={chat} />
      {broadcast && <pre id="lab-broadcast" hidden />}
      {chrome ? <LabPanel snap={snap} state={state} /> : <style>{"nextjs-portal{display:none}"}</style>}
    </div>
  );
}
