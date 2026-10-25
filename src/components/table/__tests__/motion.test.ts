import { describe, expect, it } from "vitest";
import { motionTimings } from "../motion";

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
