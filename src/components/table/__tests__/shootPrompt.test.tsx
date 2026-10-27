// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyAction, viewFor, type Action, type GameState } from "@/engine";
import { chooseAction } from "@/engine/ai";
import { autoMeldSelection } from "@/engine/hand";
import { buildScenario } from "@/engine/scenario";
import { PRESETS } from "@/engine/scenarios";
import { Recap } from "../Recap";
import { Game } from "../Game";
import type { Snapshot } from "../types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("@/lib/realtime/useTableChannel", () => ({ useTableChannel: () => ({ status: "subscribed" }), useDisconnectedPolling: () => {} }));
vi.mock("@/lib/push", () => ({ usePushNotifications: () => ({ supported: false, enabled: false, busy: false, error: null, enable: vi.fn(), disable: vi.fn() }) }));

const CODE = "TEST";
const me = { id: "u0", handle: "south", display_name: "South", avatar_seed: "South" };
const spec = PRESETS.find((p) => p.id === "shoot-after-pass")!.spec;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

/** Actions the table sent to the server. */
let sent: { type: string }[] = [];
/** The game as the mock server holds it; moves and computer turns advance it. */
let server: GameState;

/**
 * Renders seat 0 at `state`, with automatic meld on unless `autoMeld` is false. Like the real server,
 * the mock applies each action to its game and answers with the new view, and a tick plays the next
 * computer seat. With `frozen`, actions are recorded but the game never moves.
 */
async function table(state: GameState, { autoMeld = true, frozen = false, motion = "off", reduced = false } = {}) {
  sent = [];
  server = state;
  localStorage.setItem("meld.cards", JSON.stringify({ motion, autoMeld }));
  window.matchMedia = ((query: string) => ({ matches: query.includes("coarse") || query.includes("max-width") || (reduced && query.includes("reduce")), media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as unknown as typeof window.matchMedia;
  window.confirm = vi.fn(() => false);
  const snap = {
    table: { id: "t", code: CODE, host: "u0", status: "playing", rules: { ...state.rules } },
    seats: [0, 1, 2, 3].map((seat) => seat === 0 ? { seat, user_id: "u0", bot: null, profile: me } : { seat, user_id: null, profile: null, bot: "Robo" }),
    offers: [], mySeat: 0, ready: [], paused: null,
  } as unknown as Snapshot;
  const view = () => ({ ...viewFor(server, 0), ready: [] });
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/act")) {
      const action = (JSON.parse(String(init?.body)) as { action: Action }).action;
      sent.push(action);
      if (!frozen) {
        try { server = applyAction(server, action); } catch (e) { return Response.json({ error: (e as Error).message }, { status: 422 }); }
      }
      return Response.json(view());
    }
    if (url.endsWith(`/api/tables/${CODE}`)) return Response.json(snap);
    if (url.endsWith("/tick")) {
      const seat = frozen ? undefined : server.phase === "melding" ? ([1, 2, 3] as const).find((s) => !server.players[s].meldConfirmed)
        : server.turn !== null && server.turn !== 0 ? server.turn : undefined;
      if (seat !== undefined) server = applyAction(server, chooseAction(viewFor(server, seat), { seed: `${server.rev}`, config: { samples: 4, budgetMs: 2 } }));
      return Response.json({ acted: seat !== undefined, rev: server.rev, delayMs: 50 });
    }
    return Response.json(view());
  }) as typeof fetch;
  render(<Game code={CODE} me={me} snap={snap} rev={state.rev} onTableChange={() => {}} />);
  await vi.waitFor(() => { if (!document.querySelector(`[aria-label="Your hand"]`)) throw new Error("hand not rendered"); });
}

/** Your meld as automatic meld would lay it down. */
const bestMeld = () => autoMeldSelection(server.players[0].hand, server.trump!);

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("the shoot decision after the pass", () => {
  it("asks the bidder, and automatic meld waits for the answer, then melds and plays on", async () => {
    const { state } = buildScenario(spec);
    await table(state);
    expect(screen.getByText("Shoot the moon?")).toBeTruthy();
    expect(screen.getByText(/Your partner sits out; take every trick and your side gains 150 points; that wins the game/)).toBeTruthy();
    // Automatic meld is on, yet nothing is laid down while the decision is open.
    await act(() => new Promise((r) => setTimeout(r, 700)));
    expect(sent).toEqual([]);
    await act(() => { fireEvent.click(screen.getByRole("button", { name: "Play it out" })); });
    await vi.waitFor(() => expect(sent[0]).toMatchObject({ type: "decline_shoot" }));
    // Then automatic meld lays the hand down and confirms it by itself, and the server takes both.
    const cards = bestMeld();
    expect(cards.length).toBeGreaterThan(0);
    await vi.waitFor(() => expect(server.players[0].meldConfirmed).toBe(true), { timeout: 4000 });
    expect(sent.map((a) => a.type)).toEqual(["decline_shoot", "declare_meld", "confirm_meld"]);
    expect(sent[1]).toMatchObject({ cards });
    expect(server.players[0].meldPoints).toBeGreaterThan(0);
    // The computers confirm too, and trick play opens with your lead.
    await vi.waitFor(() => expect(server.phase).toBe("playing"), { timeout: 4000 });
    await vi.waitFor(() => expect(document.querySelector("[data-play-status]")?.textContent).toContain("Your play."), { timeout: 4000 });
  });

  it("with automatic meld off, waits for your own meld after the answer", async () => {
    const { state } = buildScenario(spec);
    await table(state, { autoMeld: false });
    await act(() => { fireEvent.click(screen.getByRole("button", { name: "Play it out" })); });
    await vi.waitFor(() => expect(server.phase).toBe("melding"));
    await vi.waitFor(() => screen.getByRole("button", { name: "Lay down" }));
    await act(() => new Promise((r) => setTimeout(r, 700)));
    expect(sent.map((a) => a.type)).toEqual(["decline_shoot"]);
    const cards = bestMeld();
    const buttons = [...document.querySelectorAll<HTMLButtonElement>("[data-hand-card]")];
    for (const card of cards) {
      const button = buttons.find((b) => b.dataset.handCard === card)!;
      buttons.splice(buttons.indexOf(button), 1);
      await act(() => { fireEvent.click(button, { detail: 1 }); });
    }
    await act(() => { fireEvent.click(screen.getByRole("button", { name: "Lay down" })); });
    await vi.waitFor(() => expect(server.players[0].meld.length).toBeGreaterThan(0));
    await act(() => { fireEvent.click(screen.getByRole("button", { name: /^Done, \d+ meld$/ })); });
    await vi.waitFor(() => expect(server.players[0].meldConfirmed).toBe(true));
    expect(sent.map((a) => a.type)).toEqual(["decline_shoot", "declare_meld", "confirm_meld"]);
    await vi.waitFor(() => expect(server.phase).toBe("playing"), { timeout: 4000 });
  });

  it("announces the decision when the pass back brings it to you", async () => {
    const { state } = buildScenario({ ...spec, to: "passing_back" });
    await table(state);
    for (const button of [...document.querySelectorAll<HTMLButtonElement>("[data-hand-card]")].slice(0, 4)) {
      await act(() => { fireEvent.click(button, { detail: 1 }); });
    }
    await act(() => { fireEvent.click(screen.getByRole("button", { name: "Pass 4 cards" })); });
    await vi.waitFor(() => expect(document.querySelector("[aria-live=polite]")?.textContent).toMatch(/Shoot the moon, or play it out/));
    expect(screen.getByText("Shoot the moon?")).toBeTruthy();
  });

  it("sends a shoot from the prompt", async () => {
    const { state } = buildScenario(spec);
    await table(state);
    await act(() => { fireEvent.click(screen.getByRole("button", { name: "Shoot the moon" })); });
    await vi.waitFor(() => expect(sent[0]).toMatchObject({ type: "shoot" }));
    expect(window.confirm).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(server.phase).toBe("playing"));
    expect(server.sittingOut).toBe(2);
    expect(screen.getByText("sitting out")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Lay down/ })).toBeNull();
    expect(server.highBid).toMatchObject({ shoot: true });
  });

  it.each([-30, 0, 20])("describes the target reward from a starting score of %i", async score => {
    const { state } = buildScenario({ ...spec, handNumber: 2, score: { red: score } });
    await table(state, { frozen: true });
    const text = screen.getByText(/Your partner sits out; take every trick/).textContent!;
    expect(text).toContain("take every trick and your side gains 150 points");
    expect(text.includes("that wins the game")).toBe(score >= 0);
    expect(text).not.toContain("take every trick to win the game");
  });

  it("sets your own hand aside when you sit out, with no cards to play", async () => {
    const { state } = buildScenario({ dealer: 1, bidder: 2, trump: 'S', shoot: true, rules: { shoot: 'on', passCount: 0 }, to: 'playing' });
    await table(state, { frozen: true, motion: "normal" });
    expect(screen.getByText("sitting out")).toBeTruthy();
    const stack = screen.getByRole("img", { name: "Your cards are set aside; you sit this hand out" });
    expect(screen.getByRole("group", { name: "Your hand" }).contains(stack)).toBe(true);
    // Joining mid-shoot shows the stack as it is; the fold does not replay.
    expect(stack.classList.contains("sit-out-fold")).toBe(false);
    expect(document.querySelectorAll("[data-hand-card]")).toHaveLength(0);
    expect(document.querySelector("[data-play-status]")?.textContent).toContain("Your partner is shooting the moon. You sit this hand out.");
  });

  it("shows no hand for the sitting-out partner during play, only the set-aside stack", async () => {
    const { state } = buildScenario(PRESETS.find((p) => p.id === "bid-after-shoot")!.spec);
    expect(state.sittingOut).toBe(2);
    await table(state, { frozen: true, motion: "normal" });
    const seat = document.querySelector('[data-claim-seat="2"]')!;
    expect(seat.querySelector('[aria-label="12 cards"]')).toBeNull();
    expect(seat.querySelector('[aria-label="Robo sits this hand out; cards set aside"]')).toBeTruthy();
    expect(seat.querySelector(".sit-out-fold")).toBeNull();
    // The other seats keep their fans.
    expect(document.querySelector('[data-claim-seat="1"] [aria-label="12 cards"]')).toBeTruthy();
    expect(document.querySelector('[data-claim-seat="3"] [aria-label="12 cards"]')).toBeTruthy();
  });

  it("folds the partner's cards away when the shoot is declared, then leaves the stack", async () => {
    const { state } = buildScenario(spec);
    await table(state, { motion: "normal" });
    expect(document.querySelector('[data-claim-seat="2"] [aria-label="12 cards"]')).toBeTruthy();
    await act(() => { fireEvent.click(screen.getByRole("button", { name: "Shoot the moon" })); });
    await vi.waitFor(() => expect(document.querySelector('[data-claim-seat="2"] .sit-out-fold')).toBeTruthy());
    expect(document.querySelector('[data-claim-seat="2"] [aria-label="12 cards"]')).toBeNull();
    await vi.waitFor(() => expect(document.querySelector(".sit-out-fold")).toBeNull(), { timeout: 2000 });
    expect(screen.getByRole("img", { name: "Robo sits this hand out; cards set aside" })).toBeTruthy();
  });

  it.each([["reduced motion", { motion: "normal", reduced: true }], ["motion off", { motion: "off", reduced: false }]])(
    "with %s, goes straight to the set-aside stack", async (_, opts) => {
      const { state } = buildScenario(spec);
      await table(state, opts);
      await act(() => { fireEvent.click(screen.getByRole("button", { name: "Shoot the moon" })); });
      await vi.waitFor(() => expect(screen.getByRole("img", { name: "Robo sits this hand out; cards set aside" })).toBeTruthy());
      expect(document.querySelector(".sit-out-fold")).toBeNull();
    });

  it("tells the other seats who they are waiting on", async () => {
    const { state } = buildScenario({ ...spec, bidder: 1, hands: undefined });
    expect(state.phase).toBe("deciding_shoot");
    await table(state, { frozen: true });
    expect(screen.getAllByText(/Waiting on Robo/).length).toBeGreaterThan(0);
    expect(screen.getByText("Robo may shoot the moon. Their partner sits out; they must take every trick.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Play it out" })).toBeNull();
  });
});

it.each(['hand-shoot-made', 'hand-shoot-missed'])('explains %s in the recap and result', async id => {
  const { state } = buildScenario(PRESETS.find(p => p.id === id)!.spec);
  const nameOf = (seat: 0 | 1 | 2 | 3) => ['You', 'West', 'North', 'East'][seat];
  const recap = render(<Recap view={viewFor(state, 0)} nameOf={nameOf} lastSeenRev={null} />);
  expect(screen.getByText(/North sits out with cards face down/)).toBeTruthy();
  expect(screen.getByText(id === 'hand-shoot-made' ? /shoot was made for 150 points/ : /shoot missed; the shooting side loses the game/)).toBeTruthy();
  recap.unmount();
  await table(state, { frozen: true });
  expect(screen.getByText(id === 'hand-shoot-made' ? /Every trick taken alone adds 150 points/ : /The first lost trick ends the game/)).toBeTruthy();
});
