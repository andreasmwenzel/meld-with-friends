"use client";

import { useState, type CSSProperties } from "react";
import type { SeatIndex } from "@/engine/types";
import { useCardPrefs } from "@/lib/cardPrefs";

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

export interface TableTurn {
  /** for the element that holds the chairs */
  className: string; style: CSSProperties;
  /** for anything inside it that must stay upright, such as the table code */
  still: { className: string; style: CSSProperties };
}

/**
 * Turns the table when the seat at the bottom changes. Nothing remounts, so focus and scroll stay
 * put: each turn switches between two identical animations, which is what restarts one. With the
 * card motion setting off, or reduced motion, the new seating fades in instead. Pass `enabled`
 * false where the layout is not a round table (the seating grid on phones) to land at once.
 */
export function useTableTurn(bottom: SeatIndex, enabled = true): TableTurn {
  const { prefs, reducedMotion } = useCardPrefs();
  const [seen, setSeen] = useState(bottom);
  const [turn, setTurn] = useState({ n: 0, from: 0 });
  if (seen !== bottom) {
    // Adjusting state while rendering, so the first paint of the new seating already starts turned.
    setSeen(bottom);
    setTurn(t => ({ n: t.n + 1, from: turnFrom(seen, bottom) }));
  }
  const none = { className: "", style: {}, still: { className: "", style: {} } };
  if (turn.n === 0 || !enabled) return none;
  const alt = turn.n % 2 ? "" : "-b";
  if (reducedMotion || prefs.motion === "off") {
    return { className: "table-turn-fade", style: { animationName: `card-fade${alt}` }, still: { className: "", style: {} } };
  }
  return {
    className: "table-turn", style: { "--turn-from": `${turn.from}deg`, animationName: `table-turn${alt}` } as CSSProperties,
    still: { className: "table-turn-still", style: { animationName: `table-turn-counter${alt}` } },
  };
}
