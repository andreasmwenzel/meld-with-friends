import { describe, expect, it } from "vitest";
import { dealLandsAt, dealLaunch, dealTimings, motionTimings } from "../motion";

describe("motionTimings", () => {
  it("preserves normal card and trick durations", () => {
    expect(motionTimings("normal")).toEqual({ slideMs: 280, holdMs: 900, sweepMs: 350 });
  });

  it("roughly halves durations for quick motion", () => {
    expect(motionTimings("quick")).toEqual({ slideMs: 140, holdMs: 450, sweepMs: 180 });
  });

  it("allows fades within a 300ms hold with no extra sweep when off", () => {
    const timings = motionTimings("off");
    expect(timings).toEqual({ slideMs: 150, holdMs: 300, sweepMs: 0 });
    expect(timings.slideMs * 2).toBe(timings.holdMs + timings.sweepMs);
  });
});

describe("deal timings", () => {
  it("deals nothing with motion off", () => {
    expect(dealTimings("off")).toBeNull();
  });

  it("goes round from the dealer's left, three cards at a time, in about two and a half seconds or less", () => {
    for (const pref of ["normal", "quick"] as const) {
      const t = dealTimings(pref)!;
      // The first packet to the dealer's left, then each seat in turn; the second packet starts after all four.
      expect(dealLaunch(t, 0, 0)).toBe(0);
      expect(dealLaunch(t, 1, 0)).toBeGreaterThan(dealLaunch(t, 0, 2));
      expect(dealLaunch(t, 0, 3)).toBeGreaterThan(dealLaunch(t, 3, 2));
      const last = dealLandsAt(t, 3, 11);
      expect(last).toBeLessThan(pref === "quick" ? 1500 : 2800);
    }
  });
});
