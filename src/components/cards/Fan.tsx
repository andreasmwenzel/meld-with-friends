import type { CardId } from "@/engine/types";
import { PlayingCard } from "./PlayingCard";

/** A fanned hand, laid out like cards held at the table. Static; used for display. */
export function Fan({ cards, width = 120, spread = 9, className }: {
  cards: CardId[]; width?: number; spread?: number; className?: string;
}) {
  const n = cards.length;
  const mid = (n - 1) / 2;
  return (
    <div className={className} style={{ position: "relative", height: (width * 7) / 5 + width * 0.5, width: width + (n - 1) * width * 0.42 }}>
      {cards.map((c, i) => {
        const a = (i - mid) * spread;
        return (
          <PlayingCard
            key={c + i}
            card={c}
            width={width}
            style={{
              position: "absolute",
              left: i * width * 0.42,
              bottom: 0,
              transformOrigin: "50% 120%",
              transform: `rotate(${a}deg)`,
            }}
          />
        );
      })}
    </div>
  );
}
