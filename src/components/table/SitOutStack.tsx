import type { CSSProperties } from "react";
import { CardBack } from "@/components/cards/PlayingCard";

/** How long the fold takes: the fan gathers, then the squared stack settles small. */
export const FOLD_MS = 600;

/**
 * A hand set aside for a shoot: the sitting-out partner's cards as one small squared stack.
 * It keeps the footprint the fan had, so nothing round it moves. With `fold`, the cards start in
 * their fan and gather into the stack (globals.css, `.sit-out-fold`); without it, the stack is
 * simply there, as on a reload or with motion off.
 *
 * `orient` follows the seat: a row across the table or at the bottom, or a column of cards turned
 * sideways at the left or right. `step` is the distance between neighbouring cards in the fan.
 */
export function SitOutStack({ n, team, cardW, step, orient, fold, label, token = 22, pad = 0, style, hand, handCards }: {
  n: number; team: "red" | "blue"; cardW: number; step: number; orient: "row" | "left" | "right";
  fold: boolean; label: string;
  /** width of a card in the settled stack */
  token?: number;
  /** extra room the fan kept either side of its cards */
  pad?: number;
  style?: CSSProperties;
  /** `data-hand` for scripts/overlap.mjs */
  hand?: string;
  /** `data-hand-cards`: how many cards scripts/overlap.mjs should find in the stack */
  handCards?: number;
}) {
  const cardH = (cardW * 7) / 5;
  const across = orient === "row";
  const span = Math.max(0, n - 1) * step;
  const w = across ? cardW + span : cardW + pad * 2;
  const h = across ? cardH : cardH + span;
  const turn = orient === "left" ? 90 : orient === "right" ? -90 : 0;
  const scale = Math.min(1, token / cardW);
  // A tidy stack shows a little depth: the bottom few cards peek out down and to the left, about 1.5px each.
  const depth = (i: number) => Math.min(n - 1 - i, 3) * (1.5 / scale);
  return (
    <span role="img" aria-label={label} data-hand={hand} data-hand-cards={handCards} className={`relative block shrink-0 ${fold ? "sit-out-fold" : ""}`} style={{ width: w, height: h, ...style }}>
      <span className="sit-out-stack absolute left-1/2 top-1/2" style={{ width: cardW, height: cardH, marginLeft: -cardW / 2, marginTop: -cardH / 2,
        "--fold-s": scale, transform: `scale(${scale}) rotate(-4deg)`, opacity: 0.6 } as CSSProperties}>
        {Array.from({ length: n }, (_, i) => {
          const off = (i - (n - 1) / 2) * step;
          const d = depth(i);
          return (
            <CardBack key={i} width={cardW} team={team} className="sit-out-card absolute inset-0"
              style={{ "--gx": `${across ? off : 0}px`, "--gy": `${across ? 0 : off}px`, "--gr": `${turn}deg`,
                transform: `translate(${-d}px, ${d}px) rotate(${turn}deg)`, "--sx": `${-d}px`, "--sy": `${d}px`,
                // Twelve shadows would pool into a dark blot under the stack; the bottom card casts the one shadow.
                ...(i > 0 ? { boxShadow: "none" } : {}) } as CSSProperties} />
          );
        })}
      </span>
    </span>
  );
}
