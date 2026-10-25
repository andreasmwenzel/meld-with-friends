import { DEFAULT_RULES, type CardId, type MeldKind } from "@/engine/types";
import { MELD_POINTS } from "@/engine/meld";
import { scoringFactor } from "@/engine/scoring";
import { PlayingCard } from "@/components/cards/PlayingCard";

const ROWS: { name: string; kind: MeldKind; cards: CardId[] }[] = [
  { name: "Run in trump", kind: "run", cards: ["AS0", "TS0", "KS0", "QS0", "JS0"] },
  { name: "Aces around", kind: "aces_around", cards: ["AS0", "AH0", "AD0", "AC0"] },
  { name: "Kings around", kind: "kings_around", cards: ["KS0", "KH0", "KD0", "KC0"] },
  { name: "Queens around", kind: "queens_around", cards: ["QS0", "QH0", "QD0", "QC0"] },
  { name: "Jacks around", kind: "jacks_around", cards: ["JS0", "JH0", "JD0", "JC0"] },
  { name: "Royal marriage", kind: "royal_marriage", cards: ["KS0", "QS0"] },
  { name: "Pinochle", kind: "pinochle", cards: ["QS0", "JD0"] },
  { name: "Marriage", kind: "marriage", cards: ["KH0", "QH0"] },
  { name: "Dix", kind: "dix", cards: ["9S0"] },
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
            <span className="text-chalk font-semibold" style={{ fontSize: 19 }}>{MELD_POINTS[r.kind] * scoringFactor(DEFAULT_RULES)}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}
