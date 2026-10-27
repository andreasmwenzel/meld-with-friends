import { beforeEach, expect, it, vi } from "vitest";
import { newGame } from "@/engine";
import type { GameState } from "@/engine/types";
const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), broadcast: vi.fn(), enforce: vi.fn(), table: { id: "table", code: "BCDFGH", host: "host", current_game_id: "game", status: "playing", paused_by: null as string | null } }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: mocks.from, rpc: mocks.rpc }) }));
vi.mock("../tables", () => ({ tableByCode: async () => mocks.table }));
vi.mock("../realtime", () => ({ broadcastTable: mocks.broadcast }));
vi.mock("../settings", () => ({ getSettings: async () => (await import("@/lib/settings")).DEFAULT_SETTINGS }));
vi.mock("../limits", () => ({ enforce: mocks.enforce }));
import { act, getView, tickForHuman } from "../game";
import { json } from "../http";
let state: GameState;
let ready: number[];
beforeEach(() => {
  for (const [key, value] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: "https://meld.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service-role", CRON_SECRET: "cron" })) vi.stubEnv(key, value);
  vi.clearAllMocks();
  mocks.table.paused_by = null;
  state = newGame("controls"); ready = [];
  mocks.from.mockImplementation((name: string) => {
    let single = false;
    const result = () => ({ data: name === "seats" ? single ? { seat: 1 } : [{ seat: 0, user_id: "host" }, { seat: 1, user_id: "human" }, { seat: 2, user_id: null, bot: "Otto" }] : name === "games" ? { id: "game", state, rev: state.rev, ready } : null, error: null });
    const query = { select: () => query, eq: () => query, maybeSingle: async () => { single = true; return result(); }, then: (resolve: (v: unknown) => void) => Promise.resolve(result()).then(resolve) };
    return query;
  });
  mocks.rpc.mockResolvedValue({ data: 1, error: null });
});
const submit = (user = "human") => act("BCDFGH", user, { type: "next_hand", seat: 1 }, 0, crypto.randomUUID());
it("requires all humans to ready before a non-host advances", async () => {
  state.phase = "hand_over"; ready = [1];
  await expect(submit()).rejects.toMatchObject({ status: 409 });
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("counts bots as ready and clears readiness on the next hand", async () => {
  state.phase = "hand_over"; ready = [0, 1];
  await expect(submit()).resolves.toMatchObject({ phase: "bidding", ready: [] });
});
it("allows the host to override readiness", async () => {
  state.phase = "hand_over";
  await expect(submit("host")).resolves.toMatchObject({ phase: "bidding", ready: [] });
});
it.each(["act", "tick"])("paused %s returns the exact 409 response without committing or consuming quota", async operation => {
  mocks.table.paused_by = "host";
  const response = await json(() => operation === "act" ? submit() : tickForHuman("BCDFGH", "human"));
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: "The table is paused." });
  expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.enforce).not.toHaveBeenCalled();
});
it("includes readiness on the server view without changing the engine", async () => {
  state.phase = "hand_over"; ready = [1];
  expect(await getView("BCDFGH", "human")).toMatchObject({ ready: [1] });
});
it("does not let a bot tick advance a completed hand", async () => {
  state.phase = "hand_over";
  expect(await tickForHuman("BCDFGH", "human")).toMatchObject({ acted: false, rev: 0 });
  expect(mocks.rpc).not.toHaveBeenCalled();
});
