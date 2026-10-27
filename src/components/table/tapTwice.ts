import type { CardId } from "@/engine/types";

/** With tap twice to play, a second tap on a lifted card within this long plays it; a later one puts it down. */
export const DOUBLE_TAP_MS = 500;
/** A click counts as the end of a finger or mouse press only if that press began this recently (allows a slow press). */
export const PRESS_MS = 1000;

/** A pointerdown on a hand card, kept so the click that follows can tell where it came from. */
export type Press = { card: CardId; at: number; real: boolean };

/**
 * Whether a pointerdown came from a finger, pen or real mouse. Assistive tech can synthesize pointer events
 * as a "mouse"; a phone has no fine pointer, so a mouse press there is not a hand on the screen.
 */
export function isRealPress(pointerType: string, hasFinePointer: boolean): boolean {
  return pointerType === "touch" || pointerType === "pen" || (pointerType === "mouse" && hasFinePointer);
}

/**
 * Whether a card activation gets the quick double-tap window (timed) or is exempt from it.
 * Only a click that ends a real press on the same card, begun just before it, is timed. Keyboard presses
 * (`detail` 0) and screen readers such as iOS VoiceOver, which click without touching the card (its
 * `detail` is 1), can't be quick, so they are untimed and any second press plays.
 */
export function isTimedActivation(press: Press | null, card: CardId, at: number, detail: number): boolean {
  if (detail === 0 || !press || !press.real || press.card !== card) return false;
  const since = at - press.at;
  return since >= 0 && since <= PRESS_MS;
}

export type Armed = { card: CardId; rev: number; open: boolean; timed: boolean };

/**
 * What a press on a playable card does with tap twice to play on. The first press lifts it; a second press
 * plays it while the window is `open`, and an untimed second press always plays. A timed press after the
 * window closed puts the card back down.
 */
export function secondPress(armed: Armed | null, card: CardId, rev: number, timed: boolean): "arm" | "play" | "put-back" {
  if (!armed || armed.card !== card || armed.rev !== rev) return "arm";
  if (!armed.open && timed) return "put-back";
  return "play";
}
