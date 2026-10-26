"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { MeldItem, PlayerView, SeatIndex } from "@/engine/types";
import { SUIT_GLYPH, splitCard } from "@/components/cards/PlayingCard";
import { teamOf } from "./types";

const KIND_LABEL: Record<string, string> = {
  run: "Run", double_run: "Double run", royal_marriage: "Royal marriage", marriage: "Marriage",
  pinochle: "Pinochle", double_pinochle: "Double pinochle", dix: "Dix",
};

/** "Run in ♥", "Marriage in ♠", "Pinochle", "Aces around". */
export function itemLabel(it: MeldItem): string {
  const base = KIND_LABEL[it.kind] ?? (it.kind.charAt(0).toUpperCase() + it.kind.slice(1).replaceAll("_", " "));
  const suited = ["run", "double_run", "royal_marriage", "marriage"].includes(it.kind);
  return suited ? `${base} in ${SUIT_GLYPH[splitCard(it.cards[0]).suit]}` : base;
}

/**
 * Everyone's meld on one line: a name and a total per player. Each is a button; it opens a small
 * popover listing that player's pieces. Escape, a click outside, or the same button closes it.
 */
export function MeldReview({ melds, seat, nameOf, onHide, compact = false }: {
  melds: PlayerView["melds"]; seat: SeatIndex; nameOf: (s: SeatIndex) => string; onHide?: () => void; compact?: boolean;
}) {
  const [open, setOpen] = useState<SeatIndex | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const seats = [0, 1, 2, 3].map((n) => ((seat + n) % 4) as SeatIndex);
  const popId = `${baseId}-pieces`;
  const items = open === null ? [] : melds[open] ?? [];

  useEffect(() => {
    if (open === null) return;
    const away = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(null); };
    const key = (e: KeyboardEvent) => {
      // Only while focus is in this row: Escape elsewhere (the chat box, say) belongs to that control.
      if (e.key !== "Escape" || !root.current?.contains(document.activeElement)) return;
      setOpen(null);
      root.current?.querySelector<HTMLButtonElement>(`[data-meld-seat="${open}"]`)?.focus();
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", key); };
  }, [open]);

  return (
    <div ref={root} role="group" aria-label="Meld this hand" className="relative mx-auto flex max-w-full flex-wrap items-center justify-center gap-1.5 text-xs">
      {seats.map((s) => {
        const total = (melds[s] ?? []).reduce((n, it) => n + it.points, 0);
        const on = open === s;
        return (
          <button key={s} type="button" data-meld-seat={s} aria-expanded={on} aria-controls={on ? popId : undefined}
            aria-label={`${nameOf(s)}, ${total} meld`}
            onClick={() => setOpen(on ? null : s)}
            className={`inline-flex min-h-8 items-baseline gap-1 rounded-full px-2 py-1 ${on ? "bg-chalk text-[color:var(--pip-black)]" : "bg-white/10 text-chalk hover:bg-white/20"}`}>
            <span className="max-w-[7em] truncate font-semibold"
              style={{ color: on ? undefined : teamOf(s) === "red" ? "var(--deck-red-soft)" : "var(--deck-blue-soft)" }}>{nameOf(s)}</span>
            <span className="tabular-nums">{total}</span>
          </button>
        );
      })}
      {open !== null && (
        <div id={popId} role="region" aria-label={`${nameOf(open)}'s meld`}
          className={`panel absolute left-1/2 z-40 w-max min-w-[10rem] max-w-[min(16rem,calc(100vw-2rem))] -translate-x-1/2 px-3 py-2 text-left text-sm ${compact ? "top-full mt-1.5" : "bottom-full mb-1.5"}`}>
          <p className="font-semibold" style={{ color: teamOf(open) === "red" ? "var(--deck-red)" : "var(--deck-blue)" }}>{nameOf(open)}</p>
          {items.length === 0 ? <p className="text-ink-soft">No meld this hand.</p> : (
            <ul>
              {items.map((it, i) => (
                <li key={i} className="flex justify-between gap-4 py-0.5">
                  <span>{itemLabel(it)}</span><span className="font-semibold tabular-nums">{it.points}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {onHide && (
        <button type="button" onClick={onHide} aria-label="Hide the meld row" title="Hide"
          className="inline-flex size-8 items-center justify-center rounded-full text-base leading-none text-chalk-faint hover:bg-white/10 hover:text-chalk">×</button>
      )}
    </div>
  );
}
