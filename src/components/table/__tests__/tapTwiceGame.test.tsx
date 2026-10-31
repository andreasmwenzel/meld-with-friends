// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { viewFor, type CardId } from "@/engine";
import { buildScenario } from "@/engine/scenario";
import { PRESETS } from "@/engine/scenarios";
import { Game } from "../Game";
import { DOUBLE_TAP_MS } from "../tapTwice";
import type { Snapshot } from "../types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("@/lib/realtime/useTableChannel", () => ({ useTableChannel: () => ({ status: "subscribed" }), useDisconnectedPolling: () => {} }));
vi.mock("@/lib/push", () => ({ usePushNotifications: () => ({ supported: false, enabled: false, busy: false, error: null, enable: vi.fn(), disable: vi.fn() }) }));

const CODE = "TEST";
const { state } = buildScenario(PRESETS.find((p) => p.id === "play-lead")!.spec);
const view = viewFor(state, 0);
const me = { id: "u0", handle: "south", display_name: "South", avatar_seed: "South" };
const snap: Snapshot = {
  table: { id: "t", code: CODE, host: "u0", status: "playing", rules: { ...state.rules } },
  seats: [0, 1, 2, 3].map((seat) => seat === 0 ? { seat, user_id: "u0", bot: null, profile: me } : { seat, user_id: null, profile: null, bot: "bot" }),
  offers: [], mySeat: 0, ready: [], paused: null,
} as unknown as Snapshot;

/** Actions the table sent to the server. */
let sent: { type: string; card?: CardId }[] = [];

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

beforeEach(() => {
  sent = [];
  localStorage.setItem("meld.cards", JSON.stringify({ confirmPlay: true, motion: "off" }));
  // A phone: coarse pointer, no fine one.
  window.matchMedia = ((query: string) => ({ matches: query.includes("coarse") || query.includes("max-width"), media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as unknown as typeof window.matchMedia;
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/act")) sent.push((JSON.parse(String(init?.body)) as { action: { type: string; card?: CardId } }).action);
    if (url.endsWith(`/api/tables/${CODE}`)) return Response.json(snap);
    return Response.json({ ...view, ready: [] });
  }) as typeof fetch;
});

afterEach(() => { cleanup(); vi.useRealTimers(); });

/** Renders the table and waits for the hand; returns a playable card's button. */
async function table() {
  render(<Game code={CODE} me={me} snap={snap} rev={state.rev} onTableChange={() => {}} />);
  const card = view.legal.playableCards[0];
  const button = await vi.waitFor(() => {
    const b = document.querySelector<HTMLButtonElement>(`[data-hand-card="${card}"]`);
    if (!b) throw new Error("hand not rendered");
    return b;
  });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  return button;
}

const wait = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

/** A finger pressed on the card, held for `holdMs`, let go and clicked, as a phone does it. */
async function tap(button: HTMLElement, holdMs = 60) {
  await act(() => { fireEvent.pointerDown(button, { pointerType: "touch", pointerId: 1 }); });
  await wait(holdMs);
  await act(() => { fireEvent.pointerUp(button, { pointerType: "touch", pointerId: 1 }); });
  await wait(5);
  await act(() => { fireEvent.click(button, { detail: 1 }); });
}

/** A click with no pointer press before it, as VoiceOver's double tap delivers it. */
const screenReaderPress = (button: HTMLElement) => act(() => { fireEvent.click(button, { detail: 1 }); });

/** The cards the table sent as plays. */
const played = () => sent.filter((a) => a.type === "play_card").map((a) => a.card);
/** The line above the hand that says what the next tap does. */
const status = () => document.querySelector("p[role=status]")?.textContent ?? "";

describe("tap twice to play, through the table", () => {
  it("a quick second tap plays the card", async () => {
    const button = await table();
    await tap(button);
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(status()).toBe("");
    await wait(150);
    await tap(button);
    expect(played()).toEqual([view.legal.playableCards[0]]);
  });

  it("a slow second tap puts the card back", async () => {
    const button = await table();
    await tap(button);
    await wait(DOUBLE_TAP_MS + 200);
    expect(status()).toBe("");
    await tap(button);
    expect(played()).toEqual([]);
    expect(status()).toBe("");
  });

  it("a long first press still lifts the card on the quick timing", async () => {
    const button = await table();
    await tap(button, 1500);
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(status()).toBe("");
  });

  it("a second press held over a second is late and puts the card back", async () => {
    const button = await table();
    await tap(button);
    await wait(DOUBLE_TAP_MS + 100);
    await tap(button, 1200);
    expect(played()).toEqual([]);
    expect(status()).toBe("");
  });

  it("a cancelled press does not count as a tap", async () => {
    const button = await table();
    await tap(button);
    await wait(DOUBLE_TAP_MS + 200);
    await act(() => { fireEvent.pointerDown(button, { pointerType: "touch", pointerId: 1 }); });
    await act(() => { fireEvent.pointerCancel(button, { pointerType: "touch", pointerId: 1 }); });
    // The click that may still follow arrives without a press behind it, so it is untimed and plays.
    await screenReaderPress(button);
    expect(played()).toEqual([view.legal.playableCards[0]]);
  });

  it("a press started on another card and let go on this one does not time the click", async () => {
    const button = await table();
    const other = document.querySelector<HTMLButtonElement>(`[data-hand-card="${view.legal.playableCards[1]}"]`)!;
    await tap(button);
    await wait(DOUBLE_TAP_MS + 200);
    await act(() => { fireEvent.pointerDown(other, { pointerType: "touch", pointerId: 1 }); });
    await act(() => { fireEvent.pointerUp(button, { pointerType: "touch", pointerId: 1 }); });
    await screenReaderPress(button);
    expect(played()).toEqual([view.legal.playableCards[0]]);
  });

  it("a screen-reader press with no pointer events plays whenever it comes", async () => {
    const button = await table();
    await screenReaderPress(button);
    expect(status()).toMatch(/press again to play$/);
    await wait(5000);
    expect(status()).toMatch(/press again to play$/);
    await screenReaderPress(button);
    expect(played()).toEqual([view.legal.playableCards[0]]);
  });

  it("a screen-reader press long after a real tap is still untimed", async () => {
    const button = await table();
    await tap(button);
    await wait(DOUBLE_TAP_MS + 200);
    await screenReaderPress(button);
    expect(played()).toEqual([view.legal.playableCards[0]]);
  });
});
