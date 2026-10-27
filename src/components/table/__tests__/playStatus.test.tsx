// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { viewFor, type PlayerView } from "@/engine";
import { buildScenario } from "@/engine/scenario";
import { PRESETS } from "@/engine/scenarios";
import { Game } from "../Game";
import { TRICK_HOLD_MS, TRICK_SWEEP_MS } from "../motion";
import type { Snapshot } from "../types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("@/lib/realtime/useTableChannel", () => ({ useTableChannel: () => ({ status: "subscribed" }), useDisconnectedPolling: () => {} }));
vi.mock("@/lib/push", () => ({ usePushNotifications: () => ({ supported: false, enabled: false, busy: false, error: null, enable: vi.fn(), disable: vi.fn() }) }));

const CODE = "TEST";
/** As long as a display name may be, so the status has to cut it short. */
const LONG = "Bartholomew Maximilian Featherstonehaugh-Cholmondeley of Upper Wolverhampton!!!";
const me = { id: "u0", handle: "south", display_name: "South", avatar_seed: "South" };

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

/** Requests the table made, by path. */
let requests: string[] = [];

beforeEach(() => {
  requests = [];
  localStorage.setItem("meld.cards", JSON.stringify({ confirmPlay: true, motion: "full" }));
  window.matchMedia = ((query: string) => ({ matches: query.includes("coarse") || query.includes("max-width"), media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as unknown as typeof window.matchMedia;
});

afterEach(() => { cleanup(); vi.useRealTimers(); localStorage.clear(); });

/** Sits you at seat 0 of a lab position, with West's computer under a long name, and waits for the hand. */
async function table(preset: string) {
  const { state } = buildScenario(PRESETS.find((p) => p.id === preset)!.spec);
  const view: PlayerView = viewFor(state, 0);
  const snap = {
    table: { id: "t", code: CODE, host: "u0", status: "playing", rules: { ...state.rules } },
    seats: [0, 1, 2, 3].map((seat) => seat === 0 ? { seat, user_id: "u0", bot: null, profile: me } : { seat, user_id: null, profile: null, bot: seat === 1 ? LONG : `${["", "", "North", "East"][seat]} bot` }),
    offers: [], mySeat: 0, ready: [], paused: null,
  } as unknown as Snapshot;
  window.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requests.push(new URL(url, "http://x").pathname);
    if (url.endsWith(`/api/tables/${CODE}`)) return Response.json(snap);
    if (url.endsWith("/tick")) return Response.json({ acted: false, rev: state.rev });
    return Response.json({ ...view, ready: [] });
  }) as typeof fetch;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  render(<Game code={CODE} me={me} snap={snap} rev={state.rev} onTableChange={() => {}} />);
  await vi.waitFor(() => { if (!document.querySelector("[data-hand-card]")) throw new Error("hand not rendered"); });
  return view;
}

const wait = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
/** The block above your hand. */
const block = () => document.querySelector<HTMLElement>("[data-play-status]")!;
const text = () => block().textContent ?? "";

describe("trick play status above the hand", () => {
  it("says it is your play and how to play", async () => {
    await table("play-lead");
    expect(text()).toContain("Your play.");
    expect(text()).toContain("Tap a card to play it.");
  });

  it("says the rule you must follow", async () => {
    await table("play-must-trump");
    expect(text()).toContain("Your play.");
    expect(text()).toContain("No clubs: you must trump.");
  });

  it("names whose turn it is, cutting a long name short but keeping all of it", async () => {
    await table("play-waiting");
    await wait(TRICK_HOLD_MS + TRICK_SWEEP_MS);
    expect(text()).toBe(`${LONG} to play.Last trick`);
    const name = block().querySelector<HTMLElement>(`[title="${LONG}"]`)!;
    expect(name.textContent).toBe(LONG);
    expect(name.className).toContain("truncate");
  });

  it("says who took a trick just completed and its counters", async () => {
    const view = await table("play-waiting");
    const last = view.lastTrick!;
    expect(view.rules.counting).not.toBe("classic");
    const counters = last.plays.filter((p) => ["A", "T", "K"].includes(p.card[0])).length * view.rules.counterValue;
    const who = last.winner === 0 ? "You" : last.winner === 1 ? LONG : last.winner === 2 ? "North bot" : "East bot";
    expect(text()).toContain(`${who} took it, ${counters === 0 ? "no counters" : `${counters} ${counters === 1 ? "counter" : "counters"}`}.`);
    // Once the cards are swept away, the trick is a tap away.
    await wait(TRICK_HOLD_MS + TRICK_SWEEP_MS);
    expect(text()).not.toContain("took it");
    expect(screen.getByRole("button", { name: "Last trick" })).toBeTruthy();
  });

  it("shows the last trick again and goes back to the table", async () => {
    await table("play-waiting");
    await wait(TRICK_HOLD_MS + TRICK_SWEEP_MS);
    await act(() => { fireEvent.click(screen.getByRole("button", { name: "Last trick" })); });
    expect(text()).toMatch(/^Last trick: .+ took it\./);
    const back = screen.getByRole("button", { name: "Back to the table" });
    expect(back.getAttribute("aria-expanded")).toBe("true");
    await act(() => { fireEvent.click(back); });
    expect(text()).toContain(`${LONG} to play.`);
    expect(screen.getByRole("button", { name: "Last trick" }).getAttribute("aria-expanded")).toBe("false");
  });

  it("offers a nudge once the computers have been quiet for 20 seconds, and it asks the server again", async () => {
    await table("play-waiting");
    await wait(19000);
    expect(screen.queryByRole("button", { name: "Nudge the computers" })).toBeNull();
    await wait(2000);
    const nudge = screen.getByRole("button", { name: "Nudge the computers" });
    const before = requests.length;
    await act(() => { fireEvent.click(nudge); });
    await wait(0);
    expect(requests.slice(before)).toContain(`/api/tables/${CODE}/view`);
  });

  it("gives the hand focus when the meld row is hidden", async () => {
    await table("play-lead");
    const hide = screen.getByRole("button", { name: "Hide the meld row" });
    hide.focus();
    await act(() => { fireEvent.click(hide); });
    expect(screen.queryByRole("button", { name: "Hide the meld row" })).toBeNull();
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Your hand");
  });
});
