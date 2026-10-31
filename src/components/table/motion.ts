import type { MotionPref } from "@/lib/cardPrefs";
import type { CardId } from "@/engine/types";

/** The full trick rests on the table this long, then sweeps to the winner. */
export const TRICK_HOLD_MS = 900;
export const TRICK_SWEEP_MS = 350;

/** Off uses two 150ms fades within the 300ms hold, with no separate sweep. */
export function motionTimings(pref: MotionPref) {
  switch (pref) {
    case "quick": return { slideMs: 140, holdMs: 450, sweepMs: 180 };
    case "off": return { slideMs: 150, holdMs: 300, sweepMs: 0 };
    default: return { slideMs: 280, holdMs: TRICK_HOLD_MS, sweepMs: TRICK_SWEEP_MS };
  }
}

type Rel = 0 | 1 | 2 | 3;
// Offset (px) from a seat's edge of the table to the card's slot in the centre.
const EDGE: Record<Rel, [number, number]> = { 0: [0, 130], 1: [-150, 0], 2: [0, -120], 3: [150, 0] };

/** Starting offset and a small deterministic tilt, so each card settles slightly differently. */
export function flyFrom(r: Rel, card: CardId) {
  let h = 0;
  for (const c of card) h = (h * 31 + c.charCodeAt(0)) % 997;
  const tilt = ((h % 9) - 4) * (r === 0 ? 1.5 : 2.5);
  const [x, y] = EDGE[r];
  return { "--fx": `${x}px`, "--fy": `${y}px`, "--fr": `${tilt}deg`, "--fs": r === 0 ? 1.3 : 0.9 };
}

/** Where a card heads when the trick is taken: toward the winner's seat. */
export function sweepTo(winner: Rel) {
  const [wx, wy] = EDGE[winner];
  return { "--sx": `${wx * 0.9}px`, "--sy": `${wy * 0.9}px` };
}

/** Claimed hands travel from their actual fan positions to the claimer's chair. */
export function claimSweep(from: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>, to: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>, scale = 1) {
  const x = (to.left + to.width / 2 - from.left - from.width / 2) / scale;
  const y = (to.top + to.height / 2 - from.top - from.height / 2) / scale;
  return { transform: `translate(${x}px, ${y}px) scale(.8)`, opacity: 0 };
}

/**
 * A claim shows its cards one at a time: each of the claimer's cards turns up and steps toward the cloth, the way a
 * card is lifted to be played, `stepMs` after the one before, and settles back as the next one comes. The other hands turn up together at the start. Once the
 * last claimed card has stood `holdMs`, every card sweeps to the claimer (off: fades), and then the result shows.
 */
export function claimTimings(pref: MotionPref, claimed: number) {
  const { slideMs, holdMs, sweepMs } = motionTimings(pref);
  const stepMs = pref === "quick" ? 150 : pref === "off" ? 200 : 300;
  const outMs = pref === "off" ? slideMs : sweepMs;
  // The last card turns up, stands out a step and settles back before the hold.
  const sweepAt = Math.max(0, claimed - 1) * stepMs + slideMs * 2 + stepMs + holdMs;
  return { revealMs: slideMs, stepMs, sweepAt, outMs, totalMs: sweepAt + outMs };
}

/** How far a claimed card steps toward the cloth, as far as a card lifted to be played. */
export const CLAIM_STEP_PX = 14;
