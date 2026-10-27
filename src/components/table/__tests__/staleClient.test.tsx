// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { viewFor, type PlayerView } from "@/engine";
import { buildScenario } from "@/engine/scenario";
import { PRESETS } from "@/engine/scenarios";
import { BUILD_ID, reloadPage, staleBuild } from "@/lib/staleClient";
import { Game } from "../Game";
import type { Snapshot } from "../types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("@/lib/realtime/useTableChannel", () => ({ useTableChannel: () => ({ status: "subscribed" }), useDisconnectedPolling: () => {} }));
vi.mock("@/lib/push", () => ({ usePushNotifications: () => ({ supported: false, enabled: false, busy: false, error: null, enable: vi.fn(), disable: vi.fn() }) }));
vi.mock("@/lib/staleClient", async (original) => ({ ...await original<typeof import("@/lib/staleClient")>(), reloadPage: vi.fn() }));

const CODE = "TEST";
const me = { id: "u0", handle: "south", display_name: "South", avatar_seed: "South" };

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

beforeEach(() => {
  sessionStorage.clear();
  localStorage.setItem("meld.cards", JSON.stringify({ confirmPlay: false }));
  vi.mocked(reloadPage).mockClear();
  window.matchMedia = ((query: string) => ({ matches: query.includes("coarse") || query.includes("max-width"), media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as unknown as typeof window.matchMedia;
});
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });

describe("staleBuild", () => {
  it("is false for this build and for a response without a marker", () => {
    expect(staleBuild(BUILD_ID)).toBe(false);
    expect(staleBuild(undefined)).toBe(false);
    expect(staleBuild("")).toBe(false);
    expect(sessionStorage.length).toBe(0);
  });

  it("remembers every attempted build across alternating deploys and bundles", () => {
    // Each pair represents the server build and the bundle returned by the preceding reload.
    expect(staleBuild("B", "A")).toBe(true);
    expect(staleBuild("A", "B")).toBe(true);
    expect(staleBuild("B", "A")).toBe(false);
    expect(staleBuild("A", "B")).toBe(false);
    expect(staleBuild("C", "A")).toBe(true);
    expect(staleBuild("B", "C")).toBe(false);
  });

  it("does not reload if session storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(staleBuild("B", "A")).toBe(false);
  });

  it("is true once per newer build in a tab", () => {
    expect(staleBuild("b2", "b1")).toBe(true);
    expect(staleBuild("b2", "b1")).toBe(false);
    // After the reload the old bundle came back anyway: no loop.
    expect(staleBuild("b2", "b1")).toBe(false);
    expect(staleBuild("b3", "b1")).toBe(true);
  });
});

/** Renders seat 0 with the server stamping each view with `build()`; returns a way to make the table fetch again. */
async function table(build: () => string | undefined, intercept?: (
  url: string, init: RequestInit | undefined, view: PlayerView,
) => Promise<Response> | undefined) {
  const { state } = buildScenario(PRESETS.find((p) => p.id === "play-lead")!.spec);
  const snap = {
    table: { id: "t", code: CODE, host: "u0", status: "playing", rules: { ...state.rules } },
    seats: [0, 1, 2, 3].map((seat) => seat === 0 ? { seat, user_id: "u0", bot: null, profile: me } : { seat, user_id: null, profile: null, bot: "Robo" }),
    offers: [], mySeat: 0, ready: [], paused: null,
  } as unknown as Snapshot;
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const held = intercept?.(url, init, viewFor(state, 0));
    if (held) return held;
    if (url.endsWith(`/api/tables/${CODE}`)) return Response.json(snap);
    if (url.endsWith("/tick")) return Response.json({ acted: false, rev: state.rev });
    return Response.json({ ...viewFor(state, 0), ready: [], build: build() });
  }) as typeof fetch;
  let ui!: ReturnType<typeof render>;
  await act(async () => { ui = render(<Game code={CODE} me={me} snap={snap} rev={0} onTableChange={() => {}} />); });
  await vi.waitFor(() => { if (!document.querySelector("[data-hand-card]")) throw new Error("hand not rendered"); });
  let rev = 0;
  return async () => {
    await act(async () => { ui.rerender(<Game code={CODE} me={me} snap={snap} rev={++rev} onTableChange={() => {}} />); });
    await act(() => new Promise((r) => setTimeout(r, 400)));
  };
}

describe("a table left open across a deploy", () => {
  it.each(["success", "conflict", "failure"])("waits for an overlapping action to settle: %s", async (outcome) => {
    let build = BUILD_ID;
    let finish!: () => void;
    let actions = 0;
    const refetch = await table(() => build, (url, _init, view) => {
      if (!url.endsWith("/act")) return;
      actions++;
      return new Promise<Response>((resolve) => {
        finish = () => resolve(outcome === "failure"
          ? Response.json({ error: "Invalid action" }, { status: 400 })
          : Response.json({ ...view, build }, { status: outcome === "conflict" ? 409 : 200 }));
      });
    });
    const card = document.querySelector<HTMLButtonElement>("[data-hand-card]:not([aria-disabled=true])")!;
    await act(async () => { fireEvent.click(card); });
    expect(actions).toBe(1);
    build = "next-deploy";
    await refetch();
    expect(screen.getByText("Updating the table…")).toBeTruthy();
    expect(card.closest("[inert]")).toBeTruthy();
    expect(screen.getByText("Updating the table…").closest("[inert]")).toBeNull();
    expect(reloadPage).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(card); });
    expect(actions).toBe(1);
    await act(async () => { finish(); });
    await act(() => new Promise((r) => setTimeout(r, 400)));
    expect(reloadPage).toHaveBeenCalledTimes(1);
  });

  it("waits for all overlapping mutations, including a background seen POST", async () => {
    let build = BUILD_ID;
    let finishAction!: () => void;
    let finishSeen!: () => void;
    const refetch = await table(() => build, (url, _init, view) => {
      if (url.endsWith("/seen")) return new Promise<Response>((resolve) => {
        finishSeen = () => resolve(Response.json({}));
      });
      if (url.endsWith("/act")) return new Promise<Response>((resolve) => {
        finishAction = () => resolve(Response.json({ ...view, build }));
      });
    });
    await act(() => new Promise((r) => setTimeout(r, 2100)));
    expect(finishSeen).toBeTypeOf("function");
    const card = document.querySelector<HTMLButtonElement>("[data-hand-card]:not([aria-disabled=true])")!;
    await act(async () => { fireEvent.click(card); });
    expect(finishAction).toBeTypeOf("function");
    build = "next-deploy";
    await refetch();
    expect(reloadPage).not.toHaveBeenCalled();
    await act(async () => { finishAction(); });
    await act(() => new Promise((r) => setTimeout(r, 400)));
    expect(reloadPage).not.toHaveBeenCalled();
    await act(async () => { finishSeen(); });
    await act(() => new Promise((r) => setTimeout(r, 400)));
    expect(reloadPage).toHaveBeenCalledTimes(1);
  });

  it("waits for a pending table-control POST and ignores new controls", async () => {
    let build = BUILD_ID;
    let finish!: () => void;
    let posts = 0;
    vi.spyOn(window, "prompt").mockReturnValue("");
    const refetch = await table(() => build, (url) => {
      if (!url.endsWith("/pause")) return;
      posts++;
      return new Promise<Response>((resolve) => { finish = () => resolve(Response.json({})); });
    });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Menu" })); });
    await act(async () => { fireEvent.click(screen.getByRole("tab", { name: "Options" })); });
    const pause = screen.getByRole("button", { name: "Pause the table" });
    await act(async () => { fireEvent.click(pause); });
    expect(posts).toBe(1);
    build = "next-deploy";
    await refetch();
    expect(reloadPage).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(pause); });
    expect(posts).toBe(1);
    await act(async () => { finish(); });
    await act(() => new Promise((r) => setTimeout(r, 400)));
    expect(reloadPage).toHaveBeenCalledTimes(1);
  });

  it("ignores new card actions while waiting to reload with no mutation running", async () => {
    await table(() => "next-deploy");
    const fetch = vi.spyOn(window, "fetch");
    const card = document.querySelector<HTMLButtonElement>("[data-hand-card]:not([aria-disabled=true])")!;
    await act(async () => { fireEvent.click(card); });
    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith("/act"))).toHaveLength(0);
    await act(() => new Promise((r) => setTimeout(r, 400)));
    expect(reloadPage).toHaveBeenCalledTimes(1);
  });

  it("cancels the reload when the board unmounts", async () => {
    await table(() => "next-deploy");
    cleanup();
    await new Promise((r) => setTimeout(r, 400));
    expect(reloadPage).not.toHaveBeenCalled();
  });

  it("reloads exactly once when a view comes from a newer build", async () => {
    let build = BUILD_ID;
    const refetch = await table(() => build);
    await refetch();
    expect(reloadPage).not.toHaveBeenCalled();
    build = "next-deploy";
    await refetch();
    expect(reloadPage).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Updating the table…")).toBeTruthy();
    await refetch();
    await refetch();
    expect(reloadPage).toHaveBeenCalledTimes(1);
  });

  it("never reloads while the server answers with the same build", async () => {
    const refetch = await table(() => BUILD_ID);
    await refetch();
    await refetch();
    expect(reloadPage).not.toHaveBeenCalled();
    expect(screen.queryByText("Updating the table…")).toBeNull();
  });

  it("does not reload for a server that sends no build", async () => {
    const refetch = await table(() => undefined);
    await refetch();
    expect(reloadPage).not.toHaveBeenCalled();
  });
});
