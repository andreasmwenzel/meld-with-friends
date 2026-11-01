"use client";

import { GAME_KINDS, type GameKind } from "@/engine/kinds";
import { GameCard } from "@/components/site/GameCard";

/** Choose the game by picking up its card. The chosen one lifts and takes the brass ring every chosen card wears. */
export function GamePicker({ value, onChange, compact = false }: { value: GameKind; onChange: (kind: GameKind) => void; compact?: boolean }) {
  return (
    <div role="radiogroup" aria-label="Game" className={`grid gap-2 ${compact ? "grid-cols-2" : "grid-cols-1 min-[420px]:grid-cols-2"}`}>
      {GAME_KINDS.map((g) => {
        const on = g.id === value;
        return (
          <button key={g.id} type="button" role="radio" aria-checked={on} onClick={() => onChange(g.id)}
            className="flex items-center gap-3 rounded-[12px] p-2 text-left transition-colors"
            style={on ? { background: "rgba(36,29,29,.06)" } : undefined}>
            <GameCard kind={g.id} width={compact ? 44 : 56} selected={on} style={{ transform: on ? "translateY(-3px) rotate(-3deg)" : undefined }} />
            <span className="min-w-0">
              <span className="block font-semibold text-ink">{g.name}</span>
              {!compact && <span className="block text-xs leading-snug text-ink-soft">{g.line}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}
