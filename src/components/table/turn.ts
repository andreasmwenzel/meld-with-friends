"use client";

import { useState, type CSSProperties } from "react";
import type { SeatIndex } from "@/engine/types";

/**
 * Degrees the table was turned through when the chair at `next` replaces the chair at `prev` at the
 * bottom, as the angle the new layout starts from so it can settle into place. The chair on the left
 * comes down anticlockwise (the old picture is the new one turned a quarter clockwise), the chair on
 * the right comes down clockwise, the chair across swings half a turn.
 */
export function turnFrom(prev: SeatIndex, next: SeatIndex): number {
  const rel = (next - prev + 4) % 4;
  return rel === 1 ? 90 : rel === 3 ? -90 : rel === 2 ? 180 : 0;
}

/**
 * Turns the table when the seat at the bottom changes. Spread the result onto the element that
 * holds the chairs: a new key restarts the animation, the style tells it where to start from.
 */
export function useTableTurn(bottom: SeatIndex): { key: number; className: string; style: CSSProperties } {
  const [seen, setSeen] = useState(bottom);
  const [turn, setTurn] = useState({ n: 0, from: 0 });
  if (seen !== bottom) {
    // Adjusting state while rendering, so the first paint of the new seating already starts turned.
    setSeen(bottom);
    setTurn(t => ({ n: t.n + 1, from: turnFrom(seen, bottom) }));
  }
  return { key: turn.n, className: turn.n > 0 ? "table-turn" : "", style: { "--turn-from": `${turn.from}deg` } as CSSProperties };
}
