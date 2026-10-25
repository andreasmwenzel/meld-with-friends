import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), client: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.client }));
let bump: typeof import("../metrics").bump;
beforeEach(async () => {
  vi.resetModules(); vi.resetAllMocks(); vi.useFakeTimers();
  mocks.client.mockReturnValue({ rpc: mocks.rpc });
  mocks.rpc.mockResolvedValue({ error: null });
  bump = (await import("../metrics")).bump;
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
it("flushes 50 increments grouped by key without awaiting database I/O", () => {
  mocks.rpc.mockReturnValue(new Promise(() => {}));
  for (let i = 0; i < 49; i++) bump("act");
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(bump("tick")).toBeUndefined();
  expect(mocks.rpc.mock.calls).toEqual([
    ["bump_metric", { p_key: "act", p_n: 49 }], ["bump_metric", { p_key: "tick", p_n: 1 }],
  ]);
});
it("flushes after five seconds, cancels the size-flush timer, and starts a fresh batch", async () => {
  for (let i = 0; i < 50; i++) bump("act");
  await vi.advanceTimersByTimeAsync(5000);
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
  bump("cleanup_deleted_tables", 7);
  await vi.advanceTimersByTimeAsync(4999);
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(mocks.rpc).toHaveBeenLastCalledWith("bump_metric", { p_key: "cleanup_deleted_tables", p_n: 7 });
});
it("swallows rejected RPCs, database errors and synchronous client failures, then accepts new batches", async () => {
  for (const fail of [
    () => mocks.rpc.mockRejectedValueOnce(new Error("offline")),
    () => mocks.rpc.mockResolvedValueOnce({ error: { message: "unavailable" } }),
    () => mocks.client.mockImplementationOnce(() => { throw new Error("missing env"); }),
  ]) {
    fail();
    expect(() => bump("tick_fail")).not.toThrow();
    await vi.advanceTimersByTimeAsync(5000);
  }
  bump("act");
  await vi.advanceTimersByTimeAsync(5000);
  expect(mocks.rpc).toHaveBeenLastCalledWith("bump_metric", { p_key: "act", p_n: 1 });
});
