// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Groups } from "../Groups";
import { DealTable } from "../DealTable";
import type { Group, Profile } from "@/lib/api";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/components/rules/RulesForm", () => ({ RulesForm: () => null }));
vi.mock("@/components/rules/useRulesPref", () => ({ useRulesPref: () => ({ rules: {}, setRules: vi.fn(), remember: vi.fn() }) }));

const friend = (n: number): Profile => ({ id: `f${n}`, handle: `p${n}`, display_name: `Player${n} Surname`, avatar_seed: "" });
const friends = Array.from({ length: 14 }, (_, i) => friend(i + 1));
const tuesday: Group = { id: "g1", name: "Tuesday", members: [{ userId: "f1", handle: "p1", displayName: "Player1 Surname", avatarSeed: "" }] };

let groups: Group[];
let sent: { url: string; method: string; body: unknown }[];
beforeEach(() => {
  groups = [tuesday];
  sent = [];
  globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (method !== "GET") sent.push({ url, method, body: init?.body ? JSON.parse(init.body as string) : undefined });
    const data = url === "/api/tables" ? { code: "BCDFGH" } : url === "/api/groups" && method === "GET" ? groups : {};
    return new Response(JSON.stringify(data), { status: 200 });
  }) as typeof fetch;
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

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
