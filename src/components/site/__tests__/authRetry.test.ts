import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authRetrySeconds, startAuthRetry } from "../authRetry";

describe("magic-link retry duration", () => {
  it.each([24, 1, 60])("reads the explicit %i-second Supabase cooldown", seconds => {
    expect(authRetrySeconds(`For security purposes, you can only request this after ${seconds} second${seconds === 1 ? "" : "s"}.`)).toBe(seconds);
  });

  it("allows capitalization and whitespace differences", () => {
    expect(authRetrySeconds("For Security Purposes,  you can only request this after  24 SECONDS.")).toBe(24);
  });

  it.each([
    "email rate limit exceeded",
    "Only 2 emails per hour are allowed",
    "Request failed after 24 seconds",
    "Invalid email address",
    "For security purposes, you can only request this after 0 seconds.",
    "For security purposes, you can only request this after -24 seconds.",
    "For security purposes, you can only request this after 1.5 seconds.",
    "For security purposes, you can only request this after 999999999999999999 seconds.",
  ])("leaves unrelated or invalid errors alone: %s", message => {
    expect(authRetrySeconds(message)).toBeNull();
  });
});

describe("magic-link retry countdown", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
  afterEach(() => vi.useRealTimers());

  it("counts down to zero and stops without sending anything", () => {
    const onTick = vi.fn();
    startAuthRetry(2, onTick);
    vi.advanceTimersByTime(750);
    expect(onTick).not.toHaveBeenCalled();
    vi.advanceTimersByTime(250);
    expect(onTick).toHaveBeenLastCalledWith(1);
    vi.advanceTimersByTime(1000);
    expect(onTick).toHaveBeenLastCalledWith(0);
    expect(onTick).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses elapsed wall time when a background tab resumes", () => {
    const onTick = vi.fn();
    startAuthRetry(24, onTick);
    vi.setSystemTime(20_100);
    vi.advanceTimersByTime(250);
    expect(onTick).toHaveBeenLastCalledWith(4);
    vi.setSystemTime(60_000);
    vi.advanceTimersByTime(250);
    expect(onTick).toHaveBeenLastCalledWith(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels timer callbacks on unmount", () => {
    const onTick = vi.fn();
    const cancel = startAuthRetry(24, onTick);
    cancel();
    vi.advanceTimersByTime(60_000);
    expect(onTick).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
