import { describe, expect, it } from "vitest";
import type { CardId } from "@/engine/types";
import { DOUBLE_TAP_MS, PRESS_MS, isRealPress, isTimedActivation, secondPress, type Armed, type Press } from "../tapTwice";

const CARD: CardId = "AS1";
const OTHER: CardId = "KH1";

/** Runs a press on CARD at `at`; `press` is the pointerdown before the click, if any. */
function activate(armed: Armed | null, at: number, detail: number, press: Press | null) {
  const timed = isTimedActivation(press, CARD, at, detail);
  const outcome = secondPress(armed, CARD, 3, timed);
  return { timed, outcome, armed: outcome === "arm" ? { card: CARD, rev: 3, open: true, timed } : null };
}

/** The lifted card after `ms`: a timed lift closes its window at DOUBLE_TAP_MS. */
const after = (a: Armed, ms: number): Armed => ({ ...a, open: !a.timed || ms < DOUBLE_TAP_MS });

const touch = (at: number): Press => ({ card: CARD, at, real: isRealPress("touch", false) });

describe("tap twice to play", () => {
  it("a real touch: a quick second tap plays", () => {
    const first = activate(null, 1080, 1, touch(1000));
    expect(first).toMatchObject({ timed: true, outcome: "arm" });
    const second = activate(after(first.armed!, 300), 1380, 1, touch(1300));
    expect(second.outcome).toBe("play");
  });

  it("a real touch: a slow second tap puts the card back", () => {
    const first = activate(null, 1080, 1, touch(1000));
    const second = activate(after(first.armed!, 2000), 3080, 1, touch(3000));
    expect(second).toMatchObject({ timed: true, outcome: "put-back" });
  });

  it("a click with no pointer press before it (VoiceOver, detail 1) plays whenever it comes", () => {
    const first = activate(null, 1000, 1, null);
    expect(first).toMatchObject({ timed: false, outcome: "arm" });
    expect(activate(after(first.armed!, 5000), 6000, 1, null).outcome).toBe("play");
  });

  it("a keyboard press (detail 0) plays whenever it comes, even after a touch", () => {
    const first = activate(null, 1080, 1, touch(1000));
    expect(activate(after(first.armed!, 5000), 6000, 0, touch(1000)).outcome).toBe("play");
  });

  it("a stale press or one on another card does not make a click timed", () => {
    expect(isTimedActivation(touch(1000), CARD, 1000 + PRESS_MS + 1, 1)).toBe(false);
    expect(isTimedActivation({ card: OTHER, at: 1000, real: true }, CARD, 1050, 1)).toBe(false);
  });

  it("a synthesized mouse press on a phone is not a real press", () => {
    expect(isRealPress("mouse", false)).toBe(false);
    expect(isRealPress("mouse", true)).toBe(true);
    expect(isRealPress("pen", false)).toBe(true);
    const press = { card: CARD, at: 1000, real: isRealPress("mouse", false) };
    expect(isTimedActivation(press, CARD, 1050, 1)).toBe(false);
  });

  it("a press on a different card lifts that one instead", () => {
    const armed: Armed = { card: OTHER, rev: 3, open: true, timed: true };
    expect(secondPress(armed, CARD, 3, true)).toBe("arm");
    expect(secondPress({ ...armed, card: CARD, rev: 2 }, CARD, 3, true)).toBe("arm");
  });
});
