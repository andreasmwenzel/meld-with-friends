// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useSeenReporting } from "../Recap";

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("reports the automatic meld choice with the revision, and a changed choice at once", async () => {
  const send = vi.fn(async () => null);
  const { rerender } = renderHook(({ autoMeld }) => useSeenReporting("BCDFGH", 7, send, autoMeld), { initialProps: { autoMeld: true } });
  await act(async () => { vi.advanceTimersByTime(2000); });
  expect(send).toHaveBeenLastCalledWith("/api/tables/BCDFGH/seen", { body: { rev: 7, autoMeld: true } });
  // Same revision, same choice: nothing more to say.
  await act(async () => { vi.advanceTimersByTime(30000); });
  expect(send).toHaveBeenCalledTimes(1);
  // Turning automatic meld off goes out straight away, before meld can start without you.
  rerender({ autoMeld: false });
  expect(send).toHaveBeenCalledTimes(2);
  expect(send).toHaveBeenLastCalledWith("/api/tables/BCDFGH/seen", { body: { rev: 7, autoMeld: false } });
  await act(async () => { vi.advanceTimersByTime(30000); });
  expect(send).toHaveBeenCalledTimes(2);
});

it("sends only the revision when no choice is given", async () => {
  const send = vi.fn(async () => null);
  renderHook(() => useSeenReporting("BCDFGH", 3, send));
  await act(async () => { vi.advanceTimersByTime(2000); });
  expect(send).toHaveBeenCalledWith("/api/tables/BCDFGH/seen", { body: { rev: 3 } });
});
