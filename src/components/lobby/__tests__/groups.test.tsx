// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Groups } from "../Groups";
import { DealTable } from "../DealTable";
import { Invitations, FOCUS_REFRESH_MS, type Invitation } from "../Invitations";
import { resetGroups } from "../groupsStore";
import type { Group, Profile } from "@/lib/api";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/components/rules/RulesForm", () => ({ RulesForm: () => null }));
/** Realtime channels by topic, each with its broadcast handlers, so a test can deliver an event. */
const channels = vi.hoisted(() => new Map<string, { handlers: Map<string, () => void>; removed: boolean }>());
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    channel: (topic: string) => {
      const entry = { handlers: new Map<string, () => void>(), removed: false };
      channels.set(topic, entry);
      const channel = {
        on: (_kind: string, { event }: { event: string }, handler: () => void) => { entry.handlers.set(event, handler); return channel; },
        subscribe: (cb?: (status: string) => void) => { cb?.("SUBSCRIBED"); return channel; },
        topic,
      };
      return channel;
    },
    removeChannel: async (channel: { topic: string }) => { channels.get(channel.topic)!.removed = true; },
  }),
}));
vi.mock("@/components/rules/useRulesPref", () => ({ useRulesPref: () => ({ rules: {}, setRules: vi.fn(), remember: vi.fn() }) }));

const friend = (n: number): Profile => ({ id: `f${n}`, handle: `p${n}`, display_name: `Player${n} Surname`, avatar_seed: "" });
const friends = Array.from({ length: 14 }, (_, i) => friend(i + 1));
const tuesday: Group = { id: "g1", name: "Tuesday", members: [{ userId: "f1", handle: "p1", displayName: "Player1 Surname", avatarSeed: "" }] };

let groups: Group[];
let invites: Invitation[];
let sent: { url: string; method: string; body: unknown }[];
let reads: string[];
beforeEach(() => {
  resetGroups();
  channels.clear();
  groups = [tuesday];
  invites = [];
  sent = [];
  reads = [];
  globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    if (method !== "GET") sent.push({ url, method, body });
    else reads.push(url);
    if (url === "/api/groups" && method === "POST") groups = [...groups, { id: "g2", name: body.name, members: friends.filter((f) => body.members.includes(f.id)).map((f) => ({ userId: f.id, handle: f.handle, displayName: f.display_name, avatarSeed: "" })) }];
    if (url.startsWith("/api/groups/") && method === "DELETE") groups = groups.filter((g) => !url.endsWith(g.id));
    const data = url === "/api/tables" ? { code: "BCDFGH" } : url === "/api/groups" && method === "GET" ? groups : url === "/api/invites" ? invites : {};
    return new Response(JSON.stringify(data), { status: 200 });
  }) as typeof fetch;
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks(); });

it("lists groups and saves only what changed", async () => {
  render(<Groups friends={friends} />);
  fireEvent.click(await screen.findByRole("button", { name: "Edit Tuesday" }));
  fireEvent.click(screen.getByRole("button", { name: "Player2" }));
  fireEvent.click(screen.getByRole("button", { name: "Player1" }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save" })); });
  expect(sent).toEqual([{ url: "/api/groups/g1", method: "PATCH", body: { members: ["f2"] } }]);
});

it("makes a new group with at most 12 members", async () => {
  render(<Groups friends={friends} />);
  fireEvent.click(await screen.findByRole("button", { name: "New group" }));
  fireEvent.change(screen.getByLabelText("Group name"), { target: { value: " Friday " } });
  for (const f of friends) fireEvent.click(screen.getByRole("button", { name: f.display_name.split(" ")[0] }));
  expect(screen.getByText("12 of 12")).toBeTruthy();
  expect((screen.getByRole("button", { name: "Player13" }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Make group" })); });
  expect(sent).toEqual([{ url: "/api/groups", method: "POST", body: { name: "Friday", members: friends.slice(0, 12).map(f => f.id) } }]);
});

it("deals for a chosen group", async () => {
  render(<DealTable autoOpen saved />);
  fireEvent.click(await screen.findByRole("button", { name: /Tuesday/ }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Deal" })); });
  expect(sent[0]).toEqual({ url: "/api/tables", method: "POST", body: { gameKind: "pinochle", rules: {}, groupId: "g1" } });
  expect(push).toHaveBeenCalledWith("/t/BCDFGH");
});

it("does not offer groups to guests", async () => {
  render(<DealTable autoOpen />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Deal" })).toBeTruthy());
  expect(screen.queryByText("Invite a group")).toBeNull();
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

it("shows the deal picker as soon as the first group is made in the editor", async () => {
  groups = [];
  render(<><DealTable autoOpen saved /><Groups friends={friends} /></>);
  await screen.findByText(/Make a group/);
  expect(screen.queryByText("Invite a group")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "New group" }));
  fireEvent.change(screen.getByLabelText("Group name"), { target: { value: "Friday" } });
  fireEvent.click(screen.getByRole("button", { name: "Player2" }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Make group" })); });
  expect(await screen.findByText("Invite a group")).toBeTruthy();
  expect(screen.getByRole("button", { name: /^Friday/ })).toBeTruthy();
});

it("forgets a picked group once it is deleted, and deals without it", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  render(<><DealTable autoOpen saved /><Groups friends={friends} /></>);
  fireEvent.click(await screen.findByRole("button", { name: /^Tuesday/ }));
  fireEvent.click(screen.getByRole("button", { name: "Edit Tuesday" }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Delete group" })); });
  await waitFor(() => expect(screen.queryByText("Invite a group")).toBeNull());
  sent = [];
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Deal" })); });
  expect(sent[0]).toEqual({ url: "/api/tables", method: "POST", body: { gameKind: "pinochle", rules: {} } });
});

describe("invitations", () => {
  const invite = (code: string, seated = 1): Invitation => ({ code, hostName: "Margaret", hostSeed: "0", seated, invitedAt: "2026-10-26T19:00:00Z" });
  const deliver = async (topic: string, event: string) => {
    await act(async () => { channels.get(topic)!.handlers.get(event)!(); });
  };
  const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 300)); });

  it("shows a new invitation when the host's deal nudges this player's channel", async () => {
    render(<Invitations invites={[]} userId="me" />);
    await settle();
    invites = [invite("BCDFGH")];
    await deliver("invites:me", "invites");
    expect(await screen.findByText("Margaret dealt you in")).toBeTruthy();
    expect(channels.get("table:BCDFGH")).toBeTruthy();
  });

  it("follows chair counts and drops a table that started, from the table's channel", async () => {
    invites = [invite("BCDFGH", 1)];
    render(<Invitations invites={invites} userId="me" />);
    await settle();
    invites = [invite("BCDFGH", 3)];
    await deliver("table:BCDFGH", "seats");
    expect(await screen.findByText("3 of 4 chairs taken")).toBeTruthy();
    invites = [];
    await deliver("table:BCDFGH", "game");
    await waitFor(() => expect(screen.queryByText("Margaret dealt you in")).toBeNull());
    expect(channels.get("table:BCDFGH")!.removed).toBe(true);
  });

  it("revalidates on focus, at most once per interval, and stays static without a user", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    render(<Invitations invites={[invite("BCDFGH")]} userId="me" />);
    await settle();
    expect(reads).toEqual(["/api/invites"]);
    invites = [];
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await settle();
    expect(reads).toHaveLength(1);
    now.mockReturnValue(1_000_000 + FOCUS_REFRESH_MS);
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await settle();
    expect(reads).toHaveLength(2);
    await waitFor(() => expect(screen.queryByText("Margaret dealt you in")).toBeNull());
    cleanup(); reads = []; channels.clear();
    render(<Invitations invites={[invite("BCDFGH")]} />);
    await settle();
    expect(reads).toEqual([]);
    expect(channels.size).toBe(0);
  });
});
