import type { CSSProperties } from "react";
import type { GameKind } from "@/engine/kinds";
import { gameInfo } from "@/engine/kinds";

/*
 * Each game the house plays is drawn as a playing card of its own: chalk stock, the game's signature cards as the
 * face, its name set like a court card's title. The lobby picks a game by picking up its card, and the front door
 * holds the whole set in one hand.
 */

const EDGE = "0 0 0 1px rgba(36, 29, 29, .16), var(--shadow-card)";

/** A small card inside the face, turned a little, with one index in the corner. */
function Mini({ x, y, r, index, red = false }: { x: number; y: number; r: number; index: string; red?: boolean }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${r})`}>
      <rect x="-17" y="-24" width="34" height="48" rx="3.5" fill="var(--chalk)" stroke="rgba(36,29,29,.28)" strokeWidth="1" />
      <text x="-12" y="-9" fontSize="13" fontWeight={600} fontFamily="var(--font-bodoni), serif" fill={red ? "var(--pip-red)" : "var(--pip-black)"}>{index[0]}</text>
      <text x="-12" y="3" fontSize="11" fill={red ? "var(--pip-red)" : "var(--pip-black)"}>{index[1]}</text>
      <text x="0" y="18" fontSize="20" textAnchor="middle" fill={red ? "var(--pip-red)" : "var(--pip-black)"}>{index[1]}</text>
    </g>
  );
}

function Face({ kind }: { kind: GameKind }) {
  if (kind === "hearts") {
    return (
      <>
        {/* a run of hearts coming in, and the queen of spades turned up in front of them */}
        {[[28, 46, -22, 14], [46, 34, -8, 17], [66, 36, 8, 17], [82, 50, 22, 14]].map(([x, y, r, s], i) => (
          <text key={i} x={x} y={y} fontSize={s} textAnchor="middle" fill="var(--pip-red)" transform={`rotate(${r} ${x} ${y})`}>♥</text>
        ))}
        <Mini x={50} y={78} r={6} index="Q♠" />
      </>
    );
  }
  return (
    <>
      {/* the pinochle itself: queen of spades and jack of diamonds, crossed */}
      <Mini x={38} y={66} r={-14} index="Q♠" />
      <Mini x={63} y={62} r={11} index="J♦" red />
    </>
  );
}

export function GameCard({ kind, width = 96, selected = false, className, style }: {
  kind: GameKind; width?: number; selected?: boolean; className?: string; style?: CSSProperties;
}) {
  const info = gameInfo(kind);
  return (
    <svg viewBox="0 0 100 140" width={width} height={(width * 7) / 5} aria-hidden className={className}
      style={{ display: "block", borderRadius: Math.max(4, width * 0.085), boxShadow: selected ? "0 0 0 3px var(--brass), var(--shadow-card)" : EDGE, transition: "box-shadow .16s ease, transform .16s ease", ...style }}>
      <rect width="100" height="140" rx="8.5" fill="var(--chalk)" />
      <rect x="6" y="6" width="88" height="128" rx="5" fill="none" stroke="rgba(36,29,29,.14)" strokeWidth="1" />
      <Face kind={kind} />
      <text x="50" y="122" textAnchor="middle" fontSize="15" fontStyle="italic" fontWeight={600} fontFamily="var(--font-bodoni), serif" fill="var(--ink)">{info.name}</text>
    </svg>
  );
}
