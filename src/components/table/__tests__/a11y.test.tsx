// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyAction, viewFor, type Action, type CardId, type GameState, type PlayerView } from "@/engine";
import { buildScenario } from "@/engine/scenario";
import { PRESETS } from "@/engine/scenarios";
import { Game } from "../Game";
import type { Snapshot } from "../types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("@/lib/realtime/useTableChannel", () => ({ useTableChannel: () => ({ status: "subscribed" }), useDisconnectedPolling: () => {} }));
vi.mock("@/lib/push", () => ({ usePushNotifications: () => ({ supported: false, enabled: false, busy: false, error: null, enable: vi.fn(), disable: vi.fn() }) }));

const CODE = "TEST";
const me = { id: "u0", handle: "south", display_name: "South", avatar_seed: "South" };
const CARD_NAME = /^(nine|ten|jack|queen|king|ace) of (spades|hearts|diamonds|clubs)$/;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

/** The view the fake server hands out, and the actions sent to it. */
let serving: PlayerView;
let sent: { type: string; card?: CardId }[] = [];
/** While set, a move waits for this before the fake server answers. */
let hold: Promise<void> | null = null;

beforeEach(() => {
  sent = []; hold = null;
  // Manual meld, so the meld presets hold still; a second press plays.
  localStorage.setItem("meld.cards", JSON.stringify({ confirmPlay: true, motion: "off", autoMeld: false }));
  window.matchMedia = ((query: string) => ({ matches: query.includes("coarse") || query.includes("max-width"), media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as unknown as typeof window.matchMedia;
});

afterEach(() => { cleanup(); localStorage.clear(); });

function snapFor(state: GameState): Snapshot {
  return {
    table: { id: "t", code: CODE, host: "u0", status: "playing", rules: { ...state.rules } },
    seats: [0, 1, 2, 3].map((seat) => seat === 0 ? { seat, user_id: "u0", bot: null, profile: me } : { seat, user_id: null, profile: null, bot: `${["", "West", "North", "East"][seat]} bot` }),
    offers: [], mySeat: 0, ready: [], paused: null,
  } as unknown as Snapshot;
}

/** Sits you at seat 0 of a lab position and waits for the hand (or `ready`). Moves you send are applied; computers never
 *  move: the tick says nothing happened. Anything in `around` sits on the page beside the table, as a site header would. */
async function table(preset: string, { ready = "[data-hand-card]", around = null as React.ReactNode } = {}) {
  const { state } = buildScenario(PRESETS.find((p) => p.id === preset)!.spec);
  let current = state;
  serving = viewFor(state, 0);
  const snap = snapFor(state);
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/act")) {
      const action = (JSON.parse(String(init?.body)) as { action: Action }).action;
      sent.push(action);
      if (hold) await hold;
      current = applyAction(current, action);
      serving = viewFor(current, 0);
    }
    if (url.endsWith(`/api/tables/${CODE}`)) return Response.json(snap);
    if (url.endsWith("/tick")) return Response.json({ acted: false, rev: serving.rev });
    return Response.json({ ...serving, ready: [] });
  }) as typeof fetch;
  const ui = render(<>{around}<Game code={CODE} me={me} snap={snap} rev={state.rev} onTableChange={() => {}} /></>);
  await vi.waitFor(() => { if (!document.querySelector(ready)) throw new Error("table not rendered"); });
  /** Moves the table on by `actions` and lets it fetch the new view, as a broadcast revision would. */
  const advance = async (...actions: Action[]) => {
    const next = actions.reduce(applyAction, state);
    serving = viewFor(next, 0);
    current = next;
    ui.rerender(<>{around}<Game code={CODE} me={me} snap={snap} rev={next.rev} onTableChange={() => {}} /></>);
    await vi.waitFor(() => { if (!announced()) throw new Error("nothing announced"); });
  };
  return { state, advance };
}

const hand = () => screen.getByRole("group", { name: "Your hand" });
const cards = () => within(hand()).getAllByRole("button");
const announced = () => document.querySelector("[data-announcer]")?.textContent ?? "";

/** Tab as a browser does it: the next element in document order that takes focus from the keyboard. */
function tab() {
  const stops = [...document.querySelectorAll<HTMLElement>("button, a[href], [tabindex]")]
    .filter((el) => el.tabIndex >= 0 && !(el as HTMLButtonElement).disabled && !el.closest("[inert], [hidden]"));
  const next = stops[stops.indexOf(document.activeElement as HTMLElement) + 1] ?? stops[0];
  act(() => { next.focus(); });
  return next;
}
/** Enter on a focused button: the browser sends a click with no pointer behind it. */
const enter = (el: HTMLElement) => act(() => { fireEvent.keyDown(el, { key: "Enter" }); fireEvent.click(el, { detail: 0 }); });

describe("accessible names and states at the table", () => {
  it("play-lead: every card is a named toggle, the hand has one tab stop, the menu says it is closed", async () => {
    await table("play-lead");
    // Named by rank and suit, from the card face's own label.
    expect(within(hand()).getAllByRole("button", { name: CARD_NAME })).toHaveLength(serving.hand.length);
    for (const card of cards()) {
      expect(card.getAttribute("aria-pressed")).toBe("false");
      expect(card.getAttribute("aria-disabled")).toBeNull();
    }
    expect(cards().filter((c) => c.tabIndex === 0)).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Menu" }).getAttribute("aria-expanded")).toBe("false");
    // Meld lives in the seat chips' breakdowns, not in a row of its own under the cloth.
    expect(screen.queryByRole("group", { name: "Meld this hand" })).toBeNull();
    // Your chip below the cloth says the turn is yours, as the brass ring round it shows.
    expect([...document.querySelectorAll("span")].some((el) => el.textContent === "You, your turn")).toBe(true);
  });

  it("play-must-trump: cards you may not play stay focusable, say so, and say why", async () => {
    await table("play-must-trump");
    const blocked = cards().filter((c) => c.getAttribute("aria-disabled") === "true");
    expect(blocked.length).toBeGreaterThan(0);
    const why = document.getElementById(blocked[0].getAttribute("aria-describedby")!);
    expect(why?.textContent).toBe("Not playable. No clubs: you must trump.");
    act(() => { blocked[0].focus(); });
    expect(document.activeElement).toBe(blocked[0]);
  });

  it("bid-contested: the bid picker opens a dialog, and each chip says the bid in words", async () => {
    await table("bid-contested");
    const choose = screen.getByRole("button", { name: "Choose bid" });
    expect(choose.getAttribute("aria-haspopup")).toBe("dialog");
    expect(screen.getAllByRole("button", { name: "Pass" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("group", { name: "Bid amounts", hidden: true })).toBeTruthy();
    const chips = [...document.querySelectorAll(".sr-only")].map((n) => n.textContent).filter((t) => t?.includes(": "));
    expect(chips.length).toBeGreaterThan(0);
    for (const chip of chips) expect(chip).toMatch(/^.+: (bid \d+|passed|shooting the moon)$/);
    // Every card is there to read, none can be pressed during the auction.
    expect(cards().every((c) => c.getAttribute("aria-disabled") === "true")).toBe(true);
  });

  it("meld-waiting: says who the table is waiting for, with no meld buttons to press", async () => {
    await table("meld-waiting");
    expect(screen.getByText(/^Waiting for .+ to finish melding\.$/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Lay down" })).toBeNull();
    expect(screen.getByRole("group", { name: "Your hand" })).toBeTruthy();
  });

  it("trump-pick: the four suits are named buttons in a group labelled by the prompt", async () => {
    await table("trump-pick");
    const group = screen.getByRole("group", { name: "Trump is" });
    expect(within(group).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["spades", "hearts", "clubs", "diamonds"]);
  });
});

describe("keyboard play", () => {
  it("Tab reaches the hand, arrows move along it, Enter lifts a card and Enter again plays it", async () => {
    await table("play-lead");
    act(() => { screen.getByRole("button", { name: "Menu" }).focus(); });
    // The hand is a single stop after the controls above it.
    let focused = tab();
    while (!focused.hasAttribute("data-hand-card")) focused = tab();
    const first = focused;
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(document.activeElement).not.toBe(first);
    expect(document.activeElement?.hasAttribute("data-hand-card")).toBe(true);
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(document.activeElement).toBe(cards()[0]);
    const card = document.activeElement as HTMLElement;
    await enter(card);
    expect(card.getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector("p[role=status]")?.textContent).toMatch(/press again to play$/);
    // The server holds the move: pressing again meanwhile sends nothing more and keeps the card on its way.
    let answer!: () => void;
    hold = new Promise((resolve) => { answer = resolve; });
    const played = card.getAttribute("data-hand-card")!;
    await enter(card);
    await vi.waitFor(() => expect(sent.filter((a) => a.type === "play_card")).toHaveLength(1));
    expect(sent[0].card).toBe(played);
    await enter(card);
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(sent).toHaveLength(1);
    expect(card.isConnected).toBe(true);
    expect(card.getAttribute("aria-pressed")).toBe("true");
    // Once it lands the card leaves the hand, and focus stays in the hand rather than dropping to the page.
    await act(async () => { answer(); });
    await vi.waitFor(() => expect(document.querySelector(`[data-hand-card="${played}"]`)).toBeNull());
    await vi.waitFor(() => expect(hand().contains(document.activeElement)).toBe(true));
    expect(sent).toHaveLength(1);
  });

  it("arrow keys with Alt, Ctrl or Meta held, or already handled, are left to the browser", async () => {
    await table("play-lead");
    act(() => { cards()[1].focus(); });
    const at = document.activeElement!;
    for (const init of [{ key: "ArrowLeft", altKey: true }, { key: "ArrowRight", altKey: true }, { key: "Home", ctrlKey: true }, { key: "End", metaKey: true }]) {
      expect(fireEvent.keyDown(at, init)).toBe(true);
      expect(document.activeElement).toBe(at);
    }
    // Something earlier claimed the key: the hand leaves it alone.
    const handled = new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true });
    handled.preventDefault();
    act(() => { at.dispatchEvent(handled); });
    expect(document.activeElement).toBe(at);
    fireEvent.keyDown(at, { key: "End" });
    expect(document.activeElement).toBe(cards().at(-1));
  });
});

/** Tab as the browser sends it: whoever handles the keydown may move focus; otherwise focus moves on in document order. */
function pressTab(shift = false) {
  const from = document.activeElement ?? document.body;
  let moved = false;
  act(() => { moved = !fireEvent.keyDown(from, { key: "Tab", shiftKey: shift }); });
  if (!moved) {
    if (shift) throw new Error("Shift+Tab fell through to the page");
    tab();
  }
  return document.activeElement as HTMLElement;
}

describe("the result sheet", () => {
  const sheet = () => screen.getByRole("dialog");
  const open = () => table("hand-made", { ready: "[role=dialog]", around: <button type="button">Page header</button> });

  it("keeps Tab inside, wrapping at both ends, with the page behind it out of reach", async () => {
    await open();
    await vi.waitFor(() => expect(document.activeElement).toBe(sheet()));
    expect(screen.getByRole("button", { name: "Page header", hidden: true }).closest("[inert]")).not.toBeNull();
    expect(document.querySelector("[data-announcer]")?.closest("[inert]")).toBeNull();
    const first = pressTab();
    expect(sheet().contains(first)).toBe(true);
    // Shift+Tab off the first stop goes round to the last, Tab off the last back to the first.
    const last = pressTab(true);
    expect(last).not.toBe(first);
    expect(sheet().contains(last)).toBe(true);
    expect(pressTab()).toBe(first);
    // Walking forward through every stop never leaves the sheet.
    let at = first;
    for (let i = 0; i < 10; i++) { at = pressTab(); expect(sheet().contains(at)).toBe(true); }
  });

  it("Escape looks at the table, Back returns, and Tab reaches Deal from there; the page comes back afterwards", async () => {
    await open();
    await vi.waitFor(() => expect(document.activeElement).toBe(sheet()));
    expect(document.body.style.overflow).toBe("hidden");
    act(() => { fireEvent.keyDown(document.activeElement!, { key: "Escape" }); });
    const back = screen.getByRole("button", { name: "Back to the result" });
    expect(document.activeElement).toBe(back);
    // Looking at the table lets go of the page.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Page header" }).closest("[inert]")).toBeNull();
    expect(document.body.style.overflow).toBe("");
    await enter(back);
    const look = screen.getByRole("button", { name: "Look at the table" });
    expect(document.activeElement).toBe(look);
    expect(screen.getByRole("button", { name: "Page header", hidden: true }).closest("[inert]")).not.toBeNull();
    // Look is near the end of the sheet; Tab wraps round to the top and on to Deal.
    let at: HTMLElement = look;
    const deal = screen.getByRole("button", { name: "Deal the next hand" });
    for (let i = 0; i < 6 && at !== deal; i++) at = pressTab();
    expect(document.activeElement).toBe(deal);
    await enter(deal);
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(sent.at(-1)?.type).toBe("next_hand");
    expect(screen.getByRole("button", { name: "Page header" }).closest("[inert]")).toBeNull();
    expect(document.body.style.overflow).toBe("");
  });
});

describe("the live region", () => {
  it("announces a bid in words", async () => {
    const { state, advance } = await table("bid-contested");
    await advance({ type: "bid", seat: 0, amount: state.highBid!.amount! + state.rules.bidStep });
    expect(announced()).toMatch(new RegExp(`^You bid ${state.highBid!.amount! + state.rules.bidStep}\\.`));
  });

  it("announces the cards of a trick and who took it", async () => {
    const { state, advance } = await table("play-complete-trick");
    const card = serving.legal.playableCards[0];
    await advance({ type: "play_card", seat: 0, card });
    expect(announced()).toMatch(/^You play (nine|ten|jack|queen|king|ace) of \w+\. (You take|.+ takes) the trick\./);
    expect(state.currentTrick?.plays).toHaveLength(3);
  });
});
