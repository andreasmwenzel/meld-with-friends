import type { CSSProperties } from "react";
import type { CardId, Suit, Rank } from "@/engine/types";
import type { CardPrefs } from "@/lib/cardPrefs";

export const SUIT_GLYPH: Record<Suit, string> = { S: "♠", H: "♥", D: "♦", C: "♣" };
export const SUIT_NAME: Record<Suit, string> = { S: "spades", H: "hearts", D: "diamonds", C: "clubs" };
export const RANK_LABEL: Record<Rank, string> = { A: "A", T: "10", K: "K", Q: "Q", J: "J", "9": "9" };
const RANK_NAME: Record<Rank, string> = { A: "ace", T: "ten", K: "king", Q: "queen", J: "jack", "9": "nine" };

export function suitInk(suit: Suit, fourColour: boolean): string {
  if (suit === "H") return "var(--pip-red)";
  if (suit === "D") return fourColour ? "var(--pip-blue)" : "var(--pip-red)";
  if (suit === "C") return fourColour ? "var(--pip-green)" : "var(--pip-black)";
  return "var(--pip-black)";
}

/** A suit glyph set on the cloth rather than on card stock: the same deck, in the soft inks that read on oxblood. */
export function suitInkOnCloth(suit: Suit, fourColour: boolean): string {
  if (suit === "H") return "var(--deck-red-soft)";
  if (suit === "D") return fourColour ? "var(--deck-blue-soft)" : "var(--deck-red-soft)";
  if (suit === "C") return fourColour ? "var(--pip-green-soft)" : "var(--chalk)";
  return "var(--chalk)";
}

export function splitCard(id: CardId): { rank: Rank; suit: Suit } {
  return { rank: id[0] as Rank, suit: id[1] as Suit };
}

export function cardName(id: CardId): string {
  const { rank, suit } = splitCard(id);
  return `${RANK_NAME[rank]} of ${SUIT_NAME[suit]}`;
}

type Props = {
  card: CardId;
  /** width in px; height follows the 5:7 card ratio */
  width?: number;
  selected?: boolean;
  dimmed?: boolean;
  className?: string;
  style?: CSSProperties;
  title?: string;
  /** display options; omit for the standard deck with regular indices */
  prefs?: CardPrefs;
  /** a trump card in your hand: the face takes a wash when the trump tint option is on */
  trump?: boolean;
  /** the deck's colours alone, for cards on the table that keep the standard indices; overrides prefs */
  fourColour?: boolean;
};

/**
 * A pinochle card. Chalk face, Bodoni rank, one large pip. Pure SVG so it scales from a 36px
 * trick thumbnail to a 220px hero card without losing its edge.
 */
export function PlayingCard({ card, width = 96, selected, dimmed, className, style, title, prefs, trump, fourColour }: Props) {
  const { rank, suit } = splitCard(card);
  const four = fourColour ?? prefs?.fourColour === true;
  const big = prefs?.bigIndex === true;
  const ink = suitInk(suit, four);
  const label = RANK_LABEL[rank];
  const isCourt = rank === "K" || rank === "Q" || rank === "J";
  const h = (width * 7) / 5;
  return (
    <svg
      data-card={card}
      viewBox="0 0 100 140"
      width={width}
      height={h}
      role="img"
      aria-label={title ?? cardName(card)}
      className={className}
      style={{
        display: "block",
        borderRadius: `${Math.max(4, width * 0.085)}px`,
        boxShadow: selected
          ? "0 0 0 3px var(--brass), var(--shadow-card)"
          // A hairline edge: on chalk panels (recap, meld review) the card's top otherwise vanishes into the panel.
          : "0 0 0 1px rgba(36, 29, 29, .16), var(--shadow-card)",
        transition: "transform .16s ease, box-shadow .16s ease",
        ...style,
      }}
    >
      <rect width="100" height="140" rx="8.5" fill={trump && prefs?.trumpTint ? "var(--chalk-trump)" : "var(--chalk)"} />
      {/* corner indices */}
      {big ? (
        <g fill={ink} fontFamily="var(--font-bodoni), serif" fontWeight={700}>
          <text x="3.5" y="27" fontSize={label.length > 1 ? 27 : 30} textAnchor="start" letterSpacing={label.length > 1 ? -2 : 0}>{label}</text>
          <text x="4" y="51" fontSize="25" textAnchor="start">{SUIT_GLYPH[suit]}</text>
        </g>
      ) : (
      <g fill={ink} fontFamily="var(--font-bodoni), serif" fontWeight={600}>
        <text x="7" y="25" fontSize={label.length > 1 ? 20 : 24} textAnchor="start" letterSpacing={label.length > 1 ? -1 : 0}>{label}</text>
        <text x="7" y="44" fontSize="19" textAnchor="start">{SUIT_GLYPH[suit]}</text>
        <g transform="rotate(180 50 70)">
          <text x="7" y="25" fontSize={label.length > 1 ? 20 : 24} textAnchor="start" letterSpacing={label.length > 1 ? -1 : 0}>{label}</text>
          <text x="7" y="44" fontSize="19" textAnchor="start">{SUIT_GLYPH[suit]}</text>
        </g>
      </g>
      )}
      {/* centre */}
      {isCourt ? (
        <g fill={ink}>
          <rect x="24" y="36" width="52" height="68" rx="3" fill="none" stroke={ink} strokeWidth="1.2" opacity=".55" />
          <text
            x="50" y="86" textAnchor="middle" fontSize="58"
            fontFamily="var(--font-bodoni), serif" fontStyle="italic" fontWeight={600}
          >
            {label}
          </text>
          <text x="50" y="52" textAnchor="middle" fontSize="14">{SUIT_GLYPH[suit]}</text>
          <text x="50" y="100" textAnchor="middle" fontSize="14">{SUIT_GLYPH[suit]}</text>
        </g>
      ) : rank === "A" ? (
        <text x="50" y="88" textAnchor="middle" fontSize="60" fill={ink}>{SUIT_GLYPH[suit]}</text>
      ) : rank === "T" ? (
        <g fill={ink} fontSize="20" textAnchor="middle">
          {[
            [36, 44], [64, 44], [36, 62], [64, 62], [50, 53],
            [36, 92], [64, 92], [36, 110], [64, 110], [50, 101],
          ].map(([x, y], i) => (
            <text key={i} x={x} y={y} transform={i >= 5 ? `rotate(180 ${x} ${y - 6})` : undefined}>
              {SUIT_GLYPH[suit]}
            </text>
          ))}
        </g>
      ) : (
        <g fill={ink} fontSize="20" textAnchor="middle">
          {[
            [36, 46], [64, 46], [36, 64], [64, 64], [50, 76],
            [36, 94], [64, 94], [36, 112], [64, 112],
          ].map(([x, y], i) => (
            <text key={i} x={x} y={y} transform={i >= 5 ? `rotate(180 ${x} ${y - 6})` : undefined}>
              {SUIT_GLYPH[suit]}
            </text>
          ))}
        </g>
      )}
      {/* unavailable: tint laid over the face so overlapping cards stay opaque */}
      <rect width="100" height="140" rx="8.5" fill="#5b1d25" opacity={dimmed ? 0.55 : 0} style={{ transition: "opacity .16s ease", pointerEvents: "none" }} />
    </svg>
  );
}

export function CardBack({ width = 96, team = "blue", className, style }: {
  width?: number; team?: "red" | "blue"; className?: string; style?: CSSProperties;
}) {
  const h = (width * 7) / 5;
  const fill = team === "red" ? "var(--deck-red)" : "var(--deck-blue)";
  const id = `lattice-${team}`;
  return (
    <svg data-card="back" viewBox="0 0 100 140" width={width} height={h} aria-hidden className={className}
      style={{ display: "block", borderRadius: `${Math.max(4, width * 0.085)}px`, boxShadow: "var(--shadow-card)", ...style }}>
      <defs>
        <pattern id={id} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <path d="M0 4h8M4 0v8" stroke="rgba(245,239,227,.22)" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="100" height="140" rx="8.5" fill="var(--chalk)" />
      <rect x="5" y="5" width="90" height="130" rx="5" fill={fill} />
      <rect x="5" y="5" width="90" height="130" rx="5" fill={`url(#${id})`} />
      <rect x="11" y="11" width="78" height="118" rx="3" fill="none" stroke="rgba(245,239,227,.5)" strokeWidth="1" />
    </svg>
  );
}
