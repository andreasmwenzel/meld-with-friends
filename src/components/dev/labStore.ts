// State for the dev lab: a timeline of real engine actions over a base state, with undo, branching and bots.
import { applyAction, cardLabel, IllegalAction, newGame, type Action, type GameState, type SeatIndex } from "@/engine";
import { actors, botAction, buildScenario, SEATS, type ScenarioSpec } from "@/engine/scenario";
import { presetById } from "@/engine/scenarios";
import { replayLog } from "@/engine/replay";

export interface LabFlags {
  /** Game's connection prop, to see the reconnecting banner */
  reconnecting: boolean;
  /** table paused by the host */
  paused: boolean;
  /** seats that pressed ready on the hand-over screen */
  ready: SeatIndex[];
  /** practice-style board: no ready or countdown controls */
  local: boolean;
}

export interface LabSnapshot {
  base: GameState;
  actions: Action[];
  /** how many actions are applied; actions past the cursor are the redo branch */
  cursor: number;
  view: SeatIndex;
  bots: SeatIndex[];
  running: boolean;
  /** ms between bot moves */
  speed: number;
  flags: LabFlags;
  /** what loaded this timeline, for the panel and shareable links */
  source: { kind: "preset"; id: string } | { kind: "spec"; spec: ScenarioSpec } | { kind: "import"; name: string };
  notes: string[];
  error: string | null;
  /** bumps whenever history is rewritten, so the board remounts instead of rejecting an older rev */
  epoch: number;
}

const STORAGE = "meld-lab-v1";
const others = (view: SeatIndex) => SEATS.filter(s => s !== view);

/** Expand base + actions into the state after each action. Index 0 is the base. */
function replay(base: GameState, actions: Action[]): GameState[] {
  const states = [base];
  for (const action of actions) states.push(applyAction(states.at(-1)!, action));
  return states;
}

export function describeAction(a: Action): string {
  const who = ["South", "West", "North", "East"][a.seat];
  switch (a.type) {
    case "bid": return `${who} bids ${a.amount}`;
    case "pass_bid": return `${who} passes`;
    case "shoot": return `${who} shoots the moon`;
    case "decline_shoot": return `${who} plays it out`;
    case "misdeal": return `${who} throws in for nines`;
    case "declare_trump": return `${who} names ${{ S: "spades", H: "hearts", D: "diamonds", C: "clubs" }[a.suit]}`;
    case "pass_cards": return `${who} passes ${a.cards.map(cardLabel).join(" ") || "nothing"}`;
    case "declare_meld": return `${who} lays down ${a.cards.length} cards`;
    case "confirm_meld": return `${who} confirms meld`;
    case "play_card": return `${who} plays ${cardLabel(a.card)}`;
    case "claim": return `${who} claims the rest`;
    case "next_hand": return `${who} deals the next hand`;
  }
}

function fromSpec(spec: ScenarioSpec) {
  const built = buildScenario(spec);
  // Load at the target, keeping the route there as undoable history.
  return { base: built.base, actions: built.actions, cursor: built.actions.length, notes: built.notes };
}

function initial(): LabSnapshot {
  const preset = presetById("play-lead")!;
  return {
    ...fromSpec(preset.spec), view: 0, bots: others(0), running: true, speed: 700,
    flags: { reconnecting: false, paused: false, ready: [], local: false },
    source: { kind: "preset", id: preset.id }, error: null, epoch: 0,
  };
}

type Listener = () => void;

export class LabStore {
  snap: LabSnapshot = initial();
  private states: GameState[] = replay(this.snap.base, this.snap.actions);
  private listeners = new Set<Listener>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  subscribe = (l: Listener) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  get = () => this.snap;
  get state(): GameState { return this.states[this.snap.cursor]; }
  get allStates(): readonly GameState[] { return this.states; }

  private set(patch: Partial<LabSnapshot>, opts: { rewrite?: boolean } = {}) {
    this.snap = { ...this.snap, ...patch, epoch: this.snap.epoch + (opts.rewrite ? 1 : 0) };
    this.persist();
    this.listeners.forEach(l => l());
    this.schedule();
  }

  private persist() {
    try {
      const { base, actions, cursor, view, bots, speed, source } = this.snap;
      localStorage.setItem(STORAGE, JSON.stringify({ base, actions, cursor, view, bots, speed, source }));
    } catch { /* storage full or blocked; the lab still works */ }
  }

  restore(): boolean {
    try {
      const raw = localStorage.getItem(STORAGE);
      if (!raw) return false;
      const saved = JSON.parse(raw) as Partial<LabSnapshot>;
      if (!saved.base || !saved.actions) return false;
      const played = replayLog(saved.base, saved.actions);
      // Map the old cursor through its prefix so inserted decisions keep undo/redo in place.
      const cursor = replayLog(saved.base, saved.actions.slice(0, saved.cursor ?? 0)).actions.length;
      this.states = played.states;
      this.set({ ...saved, actions: played.actions, cursor, notes: [], error: null } as LabSnapshot, { rewrite: true });
      return true;
    } catch { return false; }
  }

  /** Start a new timeline from a base state and the actions that lead to the target. */
  load(base: GameState, actions: Action[], source: LabSnapshot["source"], extra: Partial<LabSnapshot> = {}) {
    try {
      this.states = replay(base, actions);
      this.set({ base, actions, cursor: actions.length, source, notes: [], error: null, flags: { ...this.snap.flags, ready: [] }, ...extra }, { rewrite: true });
    } catch (e) {
      this.set({ error: `Could not replay: ${(e as Error).message}` });
    }
  }

  loadSpec(spec: ScenarioSpec, source: LabSnapshot["source"] = { kind: "spec", spec }, extra: Partial<LabSnapshot> = {}) {
    try {
      const built = fromSpec(spec);
      this.load(built.base, built.actions, source, extra);
      this.set({ notes: built.notes });
    } catch (e) {
      this.set({ error: (e as Error).message });
    }
  }

  loadPreset(id: string, view?: SeatIndex) {
    const preset = presetById(id);
    if (!preset) { this.set({ error: `No preset "${id}"` }); return; }
    const seat = view ?? preset.view ?? 0;
    this.loadSpec(preset.spec, { kind: "preset", id }, { view: seat, bots: preset.bots ?? others(seat) });
  }

  /** Apply an action at the cursor. A new move after an undo discards the old future, like an editor. */
  act(action: Action): GameState {
    const next = applyAction(this.state, action);
    const { actions, cursor } = this.snap;
    const rewrite = cursor < actions.length;
    this.states = [...this.states.slice(0, cursor + 1), next];
    this.set({ actions: [...actions.slice(0, cursor), action], cursor: cursor + 1, error: null }, { rewrite });
    return next;
  }

  goto(cursor: number) {
    const clamped = Math.max(0, Math.min(cursor, this.snap.actions.length));
    if (clamped !== this.snap.cursor) this.set({ cursor: clamped }, { rewrite: true });
  }
  undo = () => this.goto(this.snap.cursor - 1);
  redo = () => this.goto(this.snap.cursor + 1);

  setView(view: SeatIndex) { this.set({ view, bots: this.snap.bots.filter(s => s !== view) }, { rewrite: true }); }
  toggleBot(seat: SeatIndex) {
    const bots = this.snap.bots.includes(seat) ? this.snap.bots.filter(s => s !== seat) : [...this.snap.bots, seat].sort();
    this.set({ bots });
  }
  setRunning(running: boolean) { this.set({ running }); }
  setSpeed(speed: number) { this.set({ speed }); }
  setFlags(flags: Partial<LabFlags>) { this.set({ flags: { ...this.snap.flags, ...flags } }); }
  clearError() { this.set({ error: null }); }

  /** One bot move for the next seat that can act, whether or not that seat is a bot. */
  step(): boolean {
    const seat = actors(this.state)[0];
    if (seat === undefined) return false;
    try { this.act(botAction(this.state, seat)); return true; }
    catch (e) { this.set({ error: e instanceof IllegalAction ? e.message : `Bot failed: ${(e as Error).message}` }); return false; }
  }

  /** Let bots play every seat until the condition holds or nothing can move. */
  fastForward(until: (s: GameState) => boolean) {
    for (let guard = 0; guard < 400 && !until(this.state); guard++) if (!this.step()) break;
  }

  private schedule() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (typeof window === "undefined" || !this.snap.running) return;
    const seat = actors(this.state).find(s => this.snap.bots.includes(s));
    if (seat === undefined || this.state.phase === "hand_over") return;
    this.timer = setTimeout(() => {
      this.timer = null;
      const now = actors(this.state).find(s => this.snap.bots.includes(s));
      if (now === undefined) return;
      try { this.act(botAction(this.state, now)); }
      catch (e) { this.set({ running: false, error: `Bot at seat ${now} failed: ${(e as Error).message}` }); }
    }, this.snap.speed);
  }

  kick() { this.schedule(); }
}

export const labStore = typeof window === "undefined" ? (null as unknown as LabStore) : new LabStore();

/** Key-sorted JSON; Postgres jsonb does not keep key order. */
const canonical = (value: unknown): string => JSON.stringify(value, (_k, v) => v && typeof v === "object" && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);

/**
 * Accepts a lab export ({ base, actions }), a pulled production game ({ state, actions }), or a bare GameState.
 * Production games are rebuilt from their seed when the action log replays to the same state.
 */
export function parseImport(data: unknown): { base: GameState; actions: Action[]; note: string } {
  const obj = data as { base?: GameState; state?: GameState; actions?: Action[] } & Partial<GameState>;
  if (obj.base && Array.isArray(obj.actions)) {
    const played = replayLog(obj.base, obj.actions);
    return { base: obj.base, actions: played.actions, note: `${played.actions.length} actions` };
  }
  const state = obj.state ?? (obj.phase && obj.players ? (obj as GameState) : null);
  if (!state) throw new Error("Expected a GameState, { state, actions } or { base, actions }");
  const actions = obj.actions ?? [];
  if (actions.length) {
    for (const dealer of SEATS) {
      try {
        const start = newGame(state.seed, state.rules, dealer);
        // Older logs lack the bidder's shoot decision after the pass; replayLog fills it in.
        const played = replayLog(start, actions, state);
        const end = played.states.at(-1)!;
        if (end.rev - (played.actions.length - actions.length) === state.rev && end.phase === state.phase && canonical(end.players) === canonical(state.players) && canonical(end.score) === canonical(state.score)) {
          return { base: start, actions: played.actions, note: `Rebuilt from seed with ${played.actions.length} actions` };
        }
      } catch { /* try the next dealer */ }
    }
  }
  return { base: state, actions: [], note: actions.length ? "Action log did not replay; loaded the state alone" : "Loaded the state alone" };
}

/** URL-safe base64 of a spec, for ?spec= links. */
export const encodeSpec = (spec: ScenarioSpec) => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(spec)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const decodeSpec = (raw: string) => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(raw.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0)))) as ScenarioSpec;
