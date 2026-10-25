import type { CardId } from "@/engine/types";
import { PlayingCard } from "@/components/cards/PlayingCard";

const ROWS: { name: string; points: number; cards: CardId[] }[] = [
  { name: "Run in trump", points: 150, cards: ["AS0", "TS0", "KS0", "QS0", "JS0"] },
  { name: "Aces around", points: 100, cards: ["AS0", "AH0", "AD0", "AC0"] },
  { name: "Kings around", points: 80, cards: ["KS0", "KH0", "KD0", "KC0"] },
  { name: "Queens around", points: 60, cards: ["QS0", "QH0", "QD0", "QC0"] },
  { name: "Jacks around", points: 40, cards: ["JS0", "JH0", "JD0", "JC0"] },
  { name: "Royal marriage", points: 40, cards: ["KS0", "QS0"] },
  { name: "Pinochle", points: 40, cards: ["QS0", "JD0"] },
  { name: "Marriage", points: 20, cards: ["KH0", "QH0"] },
  { name: "Dix", points: 10, cards: ["9S0"] },
];

/** The meld table every pinochle player keeps in their head, rendered with real cards. */
export function MeldTable() {
  return (
    <ul className="grid gap-x-10 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
      {ROWS.map((r) => (
        <li key={r.name} className="flex items-center gap-4">
          <div className="flex -space-x-5 shrink-0">
            {r.cards.map((c, i) => (
              <PlayingCard key={c + i} card={c} width={40} style={{ zIndex: i }} />
            ))}
          </div>
          <div className="flex flex-1 items-baseline justify-between gap-3 border-b border-chalk-ghost pb-1.5 min-w-0">
            <span className="text-chalk truncate">{r.name}</span>
            <span className="text-chalk font-semibold" style={{ fontSize: 19 }}>{r.points}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}
