// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyAction, viewFor, type GameState, type PlayerView } from "@/engine";
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
const spec = PRESETS.find((p) => p.id === "shoot-after-pass")!.spec;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

/** Actions the table sent to the server. */
let sent: { type: string }[] = [];

/** Renders seat 0 at `state`, with automatic meld on (the default); the server answers each move with `after`. */
async function table(state: GameState, after?: (action: { type: string }) => PlayerView) {
  sent = [];
  localStorage.setItem("meld.cards", JSON.stringify({ motion: "off", autoMeld: true }));
  window.matchMedia = ((query: string) => ({ matches: query.includes("coarse") || query.includes("max-width"), media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as unknown as typeof window.matchMedia;
  window.confirm = () => true;
  const snap = {
    table: { id: "t", code: CODE, host: "u0", status: "playing", rules: { ...state.rules } },
    seats: [0, 1, 2, 3].map((seat) => seat === 0 ? { seat, user_id: "u0", bot: null, profile: me } : { seat, user_id: null, profile: null, bot: "Robo" }),
    offers: [], mySeat: 0, ready: [], paused: null,
  } as unknown as Snapshot;
  let view = viewFor(state, 0);
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/act")) {
      const action = (JSON.parse(String(init?.body)) as { action: { type: string } }).action;
      sent.push(action);
      if (after) view = after(action);
    }
    if (url.endsWith(`/api/tables/${CODE}`)) return Response.json(snap);
    if (url.endsWith("/tick")) return Response.json({ acted: false, rev: view.rev });
    return Response.json({ ...view, ready: [] });
  }) as typeof fetch;
  render(<Game code={CODE} me={me} snap={snap} rev={state.rev} onTableChange={() => {}} />);
  await vi.waitFor(() => { if (!document.querySelector("[data-hand-card]")) throw new Error("hand not rendered"); });
}

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("the shoot decision after the pass", () => {
  it("asks the bidder, and automatic meld waits for the answer", async () => {
    const { state } = buildScenario(spec);
    await table(state, (action) => viewFor(applyAction(state, { ...action, seat: 0 } as never), 0));
    expect(screen.getByText("Shoot the moon?")).toBeTruthy();
    expect(screen.getByText(/Take every trick for 100, or play out the 29\./)).toBeTruthy();
    // Automatic meld is on, yet nothing is laid down while the decision is open.
    await act(() => new Promise((r) => setTimeout(r, 700)));
    expect(sent).toEqual([]);
    await act(() => { fireEvent.click(screen.getByRole("button", { name: "Play it out" })); });
    await vi.waitFor(() => expect(sent[0]).toMatchObject({ type: "decline_shoot" }));
    // Then automatic meld lays the hand down by itself.
    await vi.waitFor(() => expect(sent.some((a) => a.type === "declare_meld")).toBe(true), { timeout: 3000 });
  });

  it("announces the decision when the pass back brings it to you", async () => {
    const { state } = buildScenario({ ...spec, to: "passing_back" });
    await table(state, (action) => viewFor(applyAction(state, { ...action, seat: 0 } as never), 0));
    for (const button of [...document.querySelectorAll<HTMLButtonElement>("[data-hand-card]")].slice(0, 4)) {
      await act(() => { fireEvent.click(button, { detail: 1 }); });
    }
    await act(() => { fireEvent.click(screen.getByRole("button", { name: "Pass 4 cards" })); });
    await vi.waitFor(() => expect(document.querySelector("[aria-live=polite]")?.textContent).toMatch(/Shoot the moon, or play it out/));
    expect(screen.getByText("Shoot the moon?")).toBeTruthy();
  });

  it("sends a shoot from the prompt", async () => {
    const { state } = buildScenario(spec);
    await table(state, (action) => viewFor(applyAction(state, { ...action, seat: 0 } as never), 0));
    await act(() => { fireEvent.click(screen.getByRole("button", { name: "Shoot the moon" })); });
    await vi.waitFor(() => expect(sent[0]).toMatchObject({ type: "shoot" }));
  });

  it("tells the other seats who they are waiting on", async () => {
    const { state } = buildScenario({ ...spec, bidder: 1, hands: undefined });
    expect(state.phase).toBe("deciding_shoot");
    await table(state);
    expect(screen.getAllByText(/Waiting on Robo/).length).toBeGreaterThan(0);
    expect(screen.getByText("Robo may shoot the moon for 100.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Play it out" })).toBeNull();
  });
});
