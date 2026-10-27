// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { viewFor } from "@/engine";
import { buildScenario } from "@/engine/scenario";
import { PRESETS } from "@/engine/scenarios";
import { TableRoom } from "../TableRoom";
import type { Snapshot } from "../types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("@/lib/push", () => ({ usePushNotifications: () => ({ supported: false, enabled: false, busy: false, error: null, enable: vi.fn(), disable: vi.fn() }) }));

/** A stand-in for the Supabase Realtime transport: channels the test can broadcast on and close. */
type Listener = { filter: { event?: string }; callback: (message: { payload: unknown }) => void };
class FakeChannel {
  listeners: Listener[] = [];
  status?: (status: string) => void;
  removed = false;
  constructor(public name: string) {}
  on(_type: string, filter: { event?: string }, callback: Listener["callback"]) { this.listeners.push({ filter, callback }); return this; }
  subscribe(status?: (status: string) => void) { this.status = status; return this; }
  presenceState() { return {}; }
  async track() {}
  async send() { return "ok"; }
  broadcast(event: string, payload: unknown) {
    for (const l of this.listeners) if (l.filter.event === event) l.callback({ payload });
  }
}
const channels: FakeChannel[] = [];
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    channel: (name: string) => { const c = new FakeChannel(name); channels.push(c); return c; },
    removeChannel: async (c: FakeChannel) => { c.removed = true; },
  }),
}));

const CODE = "TEST";
const { state } = buildScenario(PRESETS.find((p) => p.id === "play-lead")!.spec);
const view = viewFor(state, 0);
const me = { id: "u0", handle: "south", display_name: "South", avatar_seed: "South" };
const snap: Snapshot = {
  table: { id: "t", code: CODE, host: "u0", status: "playing", rules: { ...state.rules }, current_game_id: "g1" },
  seats: [0, 1, 2, 3].map((seat) => seat === 0 ? { seat, user_id: "u0", bot: null, profile: me } : { seat, user_id: null, profile: null, bot: "bot" }),
  offers: [], mySeat: 0, ready: [], paused: null,
} as unknown as Snapshot;

/** GETs the tab made, by path. */
let gets: string[] = [];
let serverRev = view.rev;
const views = () => gets.filter((p) => p.endsWith("/view")).length;
const snapshots = () => gets.filter((p) => p === `/api/tables/${CODE}`).length;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

beforeEach(() => {
  gets = []; channels.length = 0; serverRev = view.rev;
  localStorage.setItem("meld.cards", JSON.stringify({ motion: "off" }));
  window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as unknown as typeof window.matchMedia;
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!init?.method || init.method === "GET") gets.push(url);
    if (url === `/api/tables/${CODE}`) return Response.json(snap);
    if (url.endsWith("/view")) return Response.json({ ...view, rev: serverRev, ready: [] });
    return Response.json({});
  }) as typeof fetch;
});

afterEach(() => { cleanup(); vi.useRealTimers(); });

const settle = () => act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); });
const tableChannels = () => channels.filter((c) => c.name === `table:${CODE}`);
/** The server broadcasting on the table's topic, to every subscription the tab holds. */
const cast = (event: string, payload: unknown) => act(() => { for (const c of tableChannels()) c.broadcast(event, payload); });

/** Mounts the room, connects its channel and waits for the board; counts start from there. */
async function room({ connect = true } = {}) {
  const mounted = render(<TableRoom code={CODE} me={me} />);
  await vi.waitFor(() => { if (!document.querySelector("[data-hand-card]")) throw new Error("board not rendered"); });
  const [channel] = tableChannels();
  if (connect) { await act(() => { channel.status?.("SUBSCRIBED"); }); await settle(); }
  gets = [];
  return { channel, unmount: mounted.unmount };
}

describe("a mounted table room", () => {
  it("opens one table channel for the tab and removes it on leaving", async () => {
    const { unmount } = await room();
    expect(tableChannels()).toHaveLength(1);
    unmount();
    expect(tableChannels()[0].removed).toBe(true);
  });

  it("fetches the view exactly once per game event, and not the table snapshot", async () => {
    await room();
    for (const rev of [view.rev + 1, view.rev + 2]) {
      serverRev = rev;
      await cast("game", { type: "game", rev });
      await settle();
    }
    expect(views()).toBe(2);
    expect(snapshots()).toBe(0);
    // a duplicate of a revision the board has fetches nothing
    await cast("game", { type: "game", rev: serverRev });
    await settle();
    expect(views()).toBe(2);
  });

  it("fetches nothing for chat", async () => {
    await room();
    await cast("chat", { type: "chat", text: "hi" });
    for (const chat of channels.filter((c) => c.name === `chat:${CODE}`)) {
      await act(() => { chat.broadcast("message", { id: "m1", from: "u1", text: "hi" }); });
    }
    await settle();
    expect(gets).toEqual([]);
  });

  it("fetches the view when a ready check arrives, every time", async () => {
    await room();
    await cast("seats", { type: "seats" });
    await settle();
    await cast("seats", { type: "seats" });
    await settle();
    expect(views()).toBe(2);
    expect(snapshots()).toBe(2);
  });

  it("resyncs the view and the table when the tab is shown or comes back online", async () => {
    await room();
    await act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    await settle();
    expect(views()).toBe(1);
    expect(snapshots()).toBe(1);
    await act(() => { window.dispatchEvent(new Event("online")); });
    await settle();
    expect(views()).toBe(2);
    expect(snapshots()).toBe(2);
  });

  it("polls the view and the table while the channel is down, and stops once it is back", async () => {
    const { channel } = await room({ connect: false });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await act(() => { channel.status?.("CHANNEL_ERROR"); });
    await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
    expect(views()).toBe(1);
    expect(snapshots()).toBe(1);
    await act(() => { channel.status?.("SUBSCRIBED"); });
    await settle();
    gets = [];
    await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
    expect(gets).toEqual([]);
  });
});
