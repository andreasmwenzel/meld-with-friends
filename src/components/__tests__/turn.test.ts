import { expect, it } from "vitest";
import { turnFrom } from "../table/turn";

it("starts the new seating from where the old one stood", () => {
  // The chair on the left comes down anticlockwise, so the new picture starts a quarter turn clockwise.
  expect(turnFrom(0, 1)).toBe(90);
  // The chair on the right comes down clockwise.
  expect(turnFrom(0, 3)).toBe(-90);
  // The partner across swings half a turn.
  expect(turnFrom(0, 2)).toBe(180);
  expect(turnFrom(2, 2)).toBe(0);
  // Relative to any starting chair.
  expect(turnFrom(3, 0)).toBe(90);
  expect(turnFrom(1, 0)).toBe(-90);
});
