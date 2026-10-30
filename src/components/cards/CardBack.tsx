"use client";

import type { CSSProperties } from "react";
import { useCardBack, type Back } from "@/lib/cardPrefs";

/** A card face down: the team's colour, in the pattern this player picked. */
export function CardBack({ width = 96, team = "blue", design, className, style }: {
  width?: number; team?: "red" | "blue";
  /** the pattern; by default the one this player picked (Table look) */
  design?: Back;
  className?: string; style?: CSSProperties;
}) {
  const chosen = useCardBack();
  const back = design ?? chosen;
  const h = (width * 7) / 5;
  const fill = team === "red" ? "var(--deck-red)" : "var(--deck-blue)";
  const id = `back-${back}-${team}`;
  return (
    <svg data-card="back" data-back={back} viewBox="0 0 100 140" width={width} height={h} aria-hidden className={className}
      style={{ display: "block", borderRadius: `${Math.max(4, width * 0.085)}px`, boxShadow: "var(--shadow-card)", ...style }}>
      <defs>
        {back === "lattice" && (
          <pattern id={id} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <path d="M0 4h8M4 0v8" stroke="rgba(245,239,227,.22)" strokeWidth="1" />
          </pattern>
        )}
        {back === "stripes" && (
          <pattern id={id} width="7" height="140" patternUnits="userSpaceOnUse">
            <path d="M2 0v140M4.5 0v140" stroke="rgba(245,239,227,.2)" strokeWidth=".8" />
          </pattern>
        )}
        {back === "rosette" && <clipPath id={id}><rect x="5" y="5" width="90" height="130" rx="5" /></clipPath>}
      </defs>
      <rect width="100" height="140" rx="8.5" fill="var(--chalk)" />
      <rect x="5" y="5" width="90" height="130" rx="5" fill={fill} />
      {(back === "lattice" || back === "stripes") && <rect x="5" y="5" width="90" height="130" rx="5" fill={`url(#${id})`} />}
      {back === "rosette" && (
        <g clipPath={`url(#${id})`} fill="none" stroke="rgba(245,239,227,.24)" strokeWidth=".9">
          {Array.from({ length: 13 }, (_, i) => <circle key={i} cx="50" cy="70" r={6 + i * 6} />)}
          <circle cx="50" cy="70" r="2.5" fill="rgba(245,239,227,.5)" stroke="none" />
        </g>
      )}
      {back === "monogram" && (
        <>
          <circle cx="50" cy="70" r="24" fill="none" stroke="rgba(245,239,227,.4)" strokeWidth="1" />
          <text x="50" y="84" textAnchor="middle" fill="rgba(245,239,227,.72)" fontSize="40" fontWeight="700"
            style={{ fontFamily: "var(--font-bodoni), Didot, serif" }}>M</text>
        </>
      )}
      <rect x="11" y="11" width="78" height="118" rx="3" fill="none" stroke="rgba(245,239,227,.5)" strokeWidth="1" />
    </svg>
  );
}
