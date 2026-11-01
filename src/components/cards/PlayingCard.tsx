import type { CSSProperties } from "react";
import type { CardId, Suit } from "@/engine/types";
import type { HeartsCardId, StdRank } from "@/engine/hearts/types";
import type { CardPrefs } from "@/lib/cardPrefs";

/** A pinochle card ("AS0", two of each) or a standard-deck card ("2C", one of each). Rank and suit are the first two letters of both. */
export type AnyCardId = CardId | HeartsCardId;
type Rank = StdRank;

export const SUIT_GLYPH: Record<Suit, string> = { S: "♠", H: "♥", D: "♦", C: "♣" };
export const SUIT_NAME: Record<Suit, string> = { S: "spades", H: "hearts", D: "diamonds", C: "clubs" };
export const RANK_LABEL: Record<Rank, string> = { A: "A", T: "10", K: "K", Q: "Q", J: "J", "9": "9", "8": "8", "7": "7", "6": "6", "5": "5", "4": "4", "3": "3", "2": "2" };
const RANK_NAME: Record<Rank, string> = { A: "ace", T: "ten", K: "king", Q: "queen", J: "jack", "9": "nine", "8": "eight", "7": "seven", "6": "six", "5": "five", "4": "four", "3": "three", "2": "two" };

/** Pip positions for the number cards, in the 100x140 face; `r` pips stand on their heads in the lower half. */
type Pip = [number, number, boolean?];
const PIPS: Partial<Record<Rank, Pip[]>> = {
  "2": [[50, 48], [50, 112, true]],
  "3": [[50, 48], [50, 80], [50, 112, true]],
  "4": [[36, 48], [64, 48], [36, 112, true], [64, 112, true]],
  "5": [[36, 48], [64, 48], [50, 80], [36, 112, true], [64, 112, true]],
  "6": [[36, 48], [64, 48], [36, 80], [64, 80], [36, 112, true], [64, 112, true]],
  "7": [[36, 48], [64, 48], [50, 64], [36, 80], [64, 80], [36, 112, true], [64, 112, true]],
  "8": [[36, 48], [64, 48], [50, 64], [36, 80], [64, 80], [50, 98, true], [36, 112, true], [64, 112, true]],
  "9": [[36, 46], [64, 46], [36, 64], [64, 64], [50, 76], [36, 94, true], [64, 94, true], [36, 112, true], [64, 112, true]],
  T: [[36, 44], [64, 44], [36, 62], [64, 62], [50, 53], [36, 92, true], [64, 92, true], [36, 110, true], [64, 110, true], [50, 101, true]],
};

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

export function splitCard(id: AnyCardId): { rank: Rank; suit: Suit } {
  return { rank: id[0] as Rank, suit: id[1] as Suit };
}

export function cardName(id: AnyCardId): string {
  const { rank, suit } = splitCard(id);
  return `${RANK_NAME[rank]} of ${SUIT_NAME[suit]}`;
}

type Props = {
  card: AnyCardId;
  /** width in px; height follows the 5:7 card ratio */
  width?: number;
  selected?: boolean;
  dimmed?: boolean;
  className?: string;
  style?: CSSProperties;
  title?: string;
  /** display options; omit for the standard deck with regular indices */
  prefs?: CardPrefs;
  /** a trump card: the face takes a wash when the trump tint option is on */
  trump?: boolean;
  /** the deck's colours alone, for cards on the table that keep the standard indices; overrides prefs */
  fourColour?: boolean;
  /** the trump tint option alone, for those same table cards; overrides prefs */
  tint?: boolean;
};

/**
 * A playing card, from either deck. Chalk face, Bodoni rank, one large pip. Pure SVG so it scales from a 36px
 * trick thumbnail to a 220px hero card without losing its edge.
 */
export function PlayingCard({ card, width = 96, selected, dimmed, className, style, title, prefs, trump, fourColour, tint }: Props) {
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
      <rect width="100" height="140" rx="8.5" fill={trump && (tint ?? prefs?.trumpTint) ? "var(--chalk-trump)" : "var(--chalk)"} />
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
      ) : (
        <g fill={ink} fontSize="20" textAnchor="middle">
          {(PIPS[rank] ?? []).map(([x, y, flip], i) => (
            <text key={i} x={x} y={y} transform={flip ? `rotate(180 ${x} ${y - 6})` : undefined}>
              {SUIT_GLYPH[suit]}
            </text>
          ))}
        </g>
      )}
      {/* unavailable: tint laid over the face so overlapping cards stay opaque */}
      <rect width="100" height="140" rx="8.5" opacity={dimmed ? 0.55 : 0} style={{ fill: "var(--cloth)", transition: "opacity .16s ease", pointerEvents: "none" }} />
    </svg>
  );
}

export { CardBack } from "./CardBack";
