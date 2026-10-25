import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canCountdownAdvance, createNextHandCountdown, type CountdownContext } from "../nextHandCountdown";
import { newGame, viewFor } from "@/engine";
import type { SeatIndex } from "@/engine/types";
import type { Snapshot } from "../types";

describe("next-hand countdown", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(overrides: Partial<CountdownContext> = {}) {
    const onNext = vi.fn();
    const countdown = createNextHandCountdown();
    const context = { handKey: "table-1:hand-1:hand_over", allowed: true, allReady: true, onNext, ...overrides };
    countdown.update(context);
    return { countdown, context, onNext };
  }

  it("requires explicit opt-in, shows seconds, and submits only once", () => {
    const { countdown, context, onNext } = setup();
    vi.advanceTimersByTime(10000);
    expect(onNext).not.toHaveBeenCalled();
    countdown.enable();
    expect(countdown.getSnapshot().seconds).toBe(5);
    vi.advanceTimersByTime(4000);
    expect(countdown.getSnapshot().seconds).toBe(1);
    expect(onNext).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(onNext).toHaveBeenCalledTimes(1);
    countdown.update(context);
    vi.advanceTimersByTime(10000);
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(countdown.getSnapshot().enabled).toBe(false);
  });

  it("waits for all humans after opt-in, including at leisurely tables", () => {
    const { countdown, context, onNext } = setup({ allReady: false });
    countdown.enable();
    vi.advanceTimersByTime(10000);
    expect(countdown.getSnapshot()).toEqual({ enabled: true, seconds: null });
    expect(onNext).not.toHaveBeenCalled();
    countdown.update({ ...context, allReady: true });
    vi.advanceTimersByTime(4999);
    expect(onNext).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("cannot opt in when blocked", () => {
    const { countdown, onNext } = setup({ allowed: false });
    countdown.enable();
    vi.advanceTimersByTime(10000);
    expect(countdown.getSnapshot().enabled).toBe(false);
    expect(onNext).not.toHaveBeenCalled();
  });

  it.each(["pause or unmount", "blocked", "hand change", "table change", "phase change", "readiness lost"])("cancels on %s and never resumes automatically", (reason) => {
    const { countdown, context, onNext } = setup();
    countdown.enable();
    vi.advanceTimersByTime(4000);
    if (reason === "pause or unmount") countdown.cancel();
    else countdown.update({ ...context,
      allowed: reason !== "blocked",
      allReady: reason !== "readiness lost",
      handKey: reason.endsWith("change") ? reason : context.handKey,
    });
    expect(countdown.getSnapshot().enabled).toBe(false);
    countdown.update(context);
    vi.advanceTimersByTime(10000);
    expect(onNext).not.toHaveBeenCalled();
    countdown.enable();
    vi.advanceTimersByTime(5000);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("also cancels a waiting opt-in on lost eligibility", () => {
    const { countdown, context, onNext } = setup({ allReady: false });
    countdown.enable();
    countdown.update({ ...context, allowed: false });
    countdown.update({ ...context, allReady: true });
    vi.advanceTimersByTime(10000);
    expect(onNext).not.toHaveBeenCalled();
  });

  it("uses the latest action callback without restarting the timer", () => {
    const { countdown, context, onNext } = setup();
    const latest = vi.fn();
    countdown.enable();
    vi.advanceTimersByTime(4000);
    countdown.update({ ...context, onNext: latest });
    vi.advanceTimersByTime(1000);
    expect(onNext).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
  });

  it("aborts expiry validation if cancelled while the fresh reads are pending", () => {
    const { countdown, onNext } = setup();
    countdown.enable();
    vi.advanceTimersByTime(5000);
    const signal = onNext.mock.calls[0][0] as AbortSignal;
    expect(signal.aborted).toBe(false);
    countdown.cancel();
    expect(signal.aborted).toBe(true);
  });
});

describe("fresh state eligibility at expiry", () => {
  const expected = { tableId: "table", userId: "host", handNumber: 1, rev: 10 };
  function fixtures() {
    const table: Snapshot = {
      table: { id: "table", code: "ABC123", host: "host", status: "playing", rules: {} },
      seats: [
        { seat: 0, user_id: "host", profile: null, bot: null },
        { seat: 1, user_id: "guest", profile: null, bot: null },
        { seat: 2, user_id: null, profile: null, bot: "Computer" },
        { seat: 3, user_id: null, profile: null, bot: null },
      ], offers: [], mySeat: 0,
    };
    const latest = { ...viewFor(newGame("test", { pace: "leisurely" }), 0),
      phase: "hand_over" as const, handNumber: 1, rev: 10, ready: [1] as SeatIndex[],
    };
    latest.legal.canAdvanceHand = true;
    return { table, latest };
  }

  it("accepts a ready leisurely table with host opt-in, ignoring bots and empty seats", () => {
    const { table, latest } = fixtures();
    expect(canCountdownAdvance(table, latest, expected)).toBe(true);
    latest.ready = [];
    expect(canCountdownAdvance(table, latest, expected)).toBe(false);
  });

  it.each(["host", "seat", "table", "paused", "finished", "phase", "hand", "revision", "legal"])("rejects a fresh %s change", change => {
    const { table, latest } = fixtures();
    if (change === "host") table.table.host = "guest";
    if (change === "seat") table.seats[0].user_id = null;
    if (change === "table") table.table.id = "another";
    if (change === "paused") table.paused = { by: "guest", name: "Guest", at: "now", reason: null };
    if (change === "finished") table.table.status = "finished";
    if (change === "phase") Object.assign(latest, { phase: "game_over" });
    if (change === "hand") latest.handNumber++;
    if (change === "revision") latest.rev++;
    if (change === "legal") latest.legal.canAdvanceHand = false;
    expect(canCountdownAdvance(table, latest, expected)).toBe(false);
  });
});
