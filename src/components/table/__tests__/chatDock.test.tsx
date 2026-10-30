// @vitest-environment jsdom
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { viewFor } from "@/engine";
import { buildScenario } from "@/engine/scenario";
import { PRESETS } from "@/engine/scenarios";
import { Game } from "../Game";
import { ChatDock, type TableChat } from "../ChatDock";
import type { Snapshot } from "../types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("@/lib/push", () => ({ usePushNotifications: () => ({ supported: false, enabled: false, busy: false, error: null, enable: vi.fn(), disable: vi.fn() }) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

const CODE = "TEST";
const me = { id: "u0", handle: "south", display_name: "South", avatar_seed: "South" };

beforeEach(() => {
  localStorage.setItem("meld.cards", JSON.stringify({ motion: "off", autoMeld: false }));
  window.matchMedia = ((query: string) => ({ matches: query.includes("max-width"), media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as unknown as typeof window.matchMedia;
});
afterEach(() => { cleanup(); localStorage.clear(); });

/** Table talk with the room's rule for unread: messages from others count while the talk is not on screen. */
function useFakeChat(initialUnread: number) {
  const [unread, setUnread] = useState(initialUnread);
  const [messages, setMessages] = useState([{ id: "m1", from: "u1", name: "West", text: "Who dealt this?", at: 1 }]);
  const chat: TableChat = {
    messages, unread, me: "u0",
    setVisible: (visible) => { if (visible) setUnread(0); },
    send: (text) => { setMessages((m) => [...m, { id: `m${m.length + 1}`, from: "u0", name: "South", text, at: 2 }]); },
  };
  return chat;
}

function Dock({ unread = 2 }: { unread?: number }) {
  const chat = useFakeChat(unread);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  return <><button type="button">Elsewhere</button><ChatDock chat={chat} open={open} setOpen={setOpen} text={text} setText={setText} /></>;
}

const talkButton = () => screen.getByRole("button", { name: /^Table talk/ });
const popover = () => screen.queryByRole("dialog", { name: "Table talk" });

describe("table talk's button and popover", () => {
  it("names the unread count, and opening marks it seen and puts focus in the message field", async () => {
    render(<Dock unread={2} />);
    expect(talkButton().getAttribute("aria-label")).toBe("Table talk, 2 unread messages");
    expect(talkButton().getAttribute("aria-expanded")).toBe("false");
    expect(popover()).toBeNull();
    fireEvent.click(talkButton());
    await vi.waitFor(() => expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Message" })));
    expect(talkButton().getAttribute("aria-label")).toBe("Table talk");
    expect(talkButton().getAttribute("aria-expanded")).toBe("true");
    expect(within(popover()!).getByText("Who dealt this?")).toBeTruthy();
  });

  it("says one message in the singular", () => {
    render(<Dock unread={1} />);
    expect(talkButton().getAttribute("aria-label")).toBe("Table talk, 1 unread message");
  });

  it("closes on Escape and on Close with focus back on the button, and on a tap outside without moving focus", async () => {
    render(<Dock />);
    fireEvent.click(talkButton());
    const field = await screen.findByRole("textbox", { name: "Message" });
    await vi.waitFor(() => expect(document.activeElement).toBe(field));
    act(() => { fireEvent.keyDown(field, { key: "Escape" }); });
    expect(popover()).toBeNull();
    expect(document.activeElement).toBe(talkButton());

    fireEvent.click(talkButton());
    fireEvent.click(await screen.findByRole("button", { name: "Close" }));
    expect(popover()).toBeNull();
    expect(document.activeElement).toBe(talkButton());

    fireEvent.click(talkButton());
    await screen.findByRole("dialog", { name: "Table talk" });
    const elsewhere = screen.getByRole("button", { name: "Elsewhere" });
    fireEvent.pointerDown(elsewhere);
    expect(popover()).toBeNull();
    expect(document.activeElement).not.toBe(talkButton());
  });

  it("keeps the draft across closing and opening", async () => {
    render(<Dock />);
    fireEvent.click(talkButton());
    fireEvent.change(await screen.findByRole("textbox", { name: "Message" }), { target: { value: "half a thought" } });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(talkButton());
    expect((await screen.findByRole("textbox", { name: "Message" }) as HTMLInputElement).value).toBe("half a thought");
  });
});

const PAUSE = { by: "u1", name: "West", reason: "", at: new Date(0).toISOString() };

function snapFor(state: ReturnType<typeof buildScenario>["state"], paused = false): Snapshot {
  return {
    table: { id: "t", code: CODE, host: "u0", status: "playing", rules: { ...state.rules } },
    seats: [0, 1, 2, 3].map((seat) => seat === 0 ? { seat, user_id: "u0", bot: null, profile: me } : { seat, user_id: null, profile: null, bot: `${["", "West", "North", "East"][seat]} bot` }),
    offers: [], mySeat: 0, ready: [], paused: paused ? PAUSE : null,
  } as unknown as Snapshot;
}

function Table({ preset, withChat, paused }: { preset: string; withChat: boolean; paused: boolean }) {
  const chat = useFakeChat(3);
  const [{ state }] = useState(() => buildScenario(PRESETS.find((p) => p.id === preset)!.spec));
  return <Game code={CODE} me={me} snap={snapFor(state, paused)} rev={state.rev} onTableChange={() => {}} chat={withChat ? chat : undefined} />;
}

async function table(preset: string, withChat = true, ready = "[data-hand-card]", paused = false) {
  const { state } = buildScenario(PRESETS.find((p) => p.id === preset)!.spec);
  const view = viewFor(state, 0);
  window.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith(`/api/tables/${CODE}`)) return Response.json(snapFor(state, paused));
    if (url.endsWith("/tick")) return Response.json({ acted: false, rev: view.rev });
    return Response.json({ ...view, ready: [] });
  }) as typeof fetch;
  render(<Table preset={preset} withChat={withChat} paused={paused} />);
  await vi.waitFor(() => { if (!document.querySelector(ready)) throw new Error("table not rendered"); });
}

describe("table talk at the board", () => {
  it("has its own button with the unread count, and the menu no longer has a Talk tab", async () => {
    await table("play-lead");
    expect(talkButton().getAttribute("aria-label")).toBe("Table talk, 3 unread messages");
    expect(screen.getByRole("button", { name: "Menu" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    const tabs = within(screen.getByRole("tablist", { name: "Menu" })).getAllByRole("tab").map((t) => t.textContent);
    expect(tabs).toEqual(["Score", "This hand", "Rules", "Options"]);
  });

  it("shows the table's house rules in the menu's Rules tab", async () => {
    // This preset turns passing off and shooting on, so default rules would read differently.
    await table("bid-shoot");
    fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    fireEvent.click(screen.getByRole("tab", { name: "Rules" }));
    const panel = screen.getByRole("tabpanel", { name: "Rules" });
    // The same grid as the deal form, read-only: each rule's value where its select would be.
    expect(within(panel).queryByRole("combobox")).toBeNull();
    const value = (label: string) => within(panel).getByText(label).nextElementSibling?.firstElementChild?.textContent;
    expect(value("Pass cards")).toBe("No passing");
    expect(value("Shooting the moon")).toBe("Allowed");
    expect(panel.tabIndex).toBe(0);
  });

  it("closes when the menu opens, so messages hidden behind the menu count as unread", async () => {
    await table("play-lead");
    fireEvent.click(talkButton());
    await vi.waitFor(() => { if (talkButton().getAttribute("aria-expanded") !== "true") throw new Error("talk not open"); });
    fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    await vi.waitFor(() => { if (talkButton().getAttribute("aria-expanded") !== "false") throw new Error("talk still open"); });
  });

  it("is not there without table talk (practice, the lab by default)", async () => {
    await table("play-lead", false);
    expect(screen.queryByRole("button", { name: /^Table talk/ })).toBeNull();
  });

  it("waits on the pause banner while the paused board is out of reach", async () => {
    await table("play-lead", true, "[data-hand-card]", true);
    expect(talkButton().closest("[inert]")).toBeNull();
    expect(screen.getAllByRole("button", { name: /^Table talk/ })).toHaveLength(1);
    fireEvent.click(talkButton());
    await vi.waitFor(() => expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Message" })));
  });

  it("moves onto the result sheet at hand end, where Escape closes the talk before it lets go of the sheet", async () => {
    await table("hand-made", true, "[role=dialog]");
    const sheet = screen.getByRole("dialog", { name: /made/ });
    expect(sheet.contains(talkButton())).toBe(true);
    fireEvent.click(talkButton());
    const field = await screen.findByRole("textbox", { name: "Message" });
    expect(sheet.contains(field)).toBe(true);
    act(() => { fireEvent.keyDown(field, { key: "Escape" }); });
    expect(popover()).toBeNull();
    expect(screen.getByRole("dialog", { name: /made/ })).toBe(sheet);
  });
});

describe("table and cards at the board", () => {
  const cog = () => screen.getByRole("button", { name: "Table and cards" });

  it("opens every card option from a cog, and a choice lays the cloth and changes the backs at once", async () => {
    await table("play-lead");
    fireEvent.click(cog());
    const pop = await screen.findByRole("dialog", { name: "Table and cards" });
    expect(within(pop).getByRole("group", { name: "Deck" })).toBeTruthy();
    expect(within(pop).getByRole("group", { name: "Hand order" })).toBeTruthy();
    fireEvent.click(within(pop).getByRole("button", { name: "Baize" }));
    expect(document.documentElement.dataset.cloth).toBe("baize");
    expect(JSON.parse(localStorage.getItem("meld.cards")!).cloth).toBe("baize");
    fireEvent.click(within(pop).getByRole("button", { name: "Rosette" }));
    const backs = [...document.querySelectorAll("[data-hand=north] [data-back]")].map((b) => (b as HTMLElement).dataset.back);
    expect(backs.length).toBeGreaterThan(0);
    expect(new Set(backs)).toEqual(new Set(["rosette"]));
    fireEvent.keyDown(pop, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Table and cards" })).toBeNull();
  });

  it("keeps the card options out of the menu, which hands over to the cog", async () => {
    await table("play-lead");
    fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    fireEvent.click(screen.getByRole("tab", { name: "Options" }));
    const panel = screen.getByRole("tabpanel", { name: "Options" });
    expect(within(panel).queryByRole("group", { name: "Deck" })).toBeNull();
    fireEvent.click(within(panel).getByRole("button", { name: "Table and cards" }));
    expect(await screen.findByRole("dialog", { name: "Table and cards" })).toBeTruthy();
    expect(cog().getAttribute("aria-expanded")).toBe("true");
  });
});
