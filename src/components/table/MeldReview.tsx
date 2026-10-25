"use client";

import { useId, useRef } from "react";
import type { PlayerView, SeatIndex } from "@/engine/types";
import { PlayingCard } from "@/components/cards/PlayingCard";
import { useCardPrefs } from "@/lib/cardPrefs";
import { teamOf } from "./types";

/** Review only the public declarations; the live board keeps updating behind the dialog. */
export function MeldReview({ melds, seat, handNumber, nameOf }: {
  melds: PlayerView["melds"]; seat: SeatIndex; handNumber: number; nameOf: (s: SeatIndex) => string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const { prefs } = useCardPrefs();
  const seats = [0, 1, 2, 3].map((n) => ((seat + n) % 4) as SeatIndex);

  return (
    <>
      <button type="button" className="btn btn-ghost btn-compact" aria-haspopup="dialog" onClick={() => dialog.current?.showModal()}>
        Review meld
      </button>
      <dialog ref={dialog} aria-labelledby={titleId}
        className="panel fixed inset-0 m-auto max-h-[78dvh] w-[calc(100%-2rem)] max-w-md overflow-y-auto p-4 backdrop:bg-black/55 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 id={titleId} className="display" style={{ fontSize: 26 }}>Hand {handNumber} meld</h2>
          <button type="button" className="btn btn-ink btn-compact" onClick={() => dialog.current?.close()}>Close</button>
        </div>
        <ul className="mt-3 space-y-4 text-sm">
          {seats.map((s) => {
            const items = melds[s];
            return (
              <li key={s}>
                <p className="flex justify-between gap-3 font-semibold">
                  <span className="min-w-0 break-words" style={{ color: teamOf(s) === "red" ? "var(--deck-red)" : "var(--deck-blue)" }}>{nameOf(s)}</span>
                  <span className="shrink-0 tabular-nums">{items.reduce((total, item) => total + item.points, 0)} points</span>
                </p>
                {items.length === 0 ? <p className="mt-1 text-ink-soft">No meld declared.</p> : (
                  <ul className="mt-1 space-y-2">
                    {items.map((item, i) => (
                      <li key={i}>
                        <p className="capitalize">{item.kind.replaceAll("_", " ")} · {item.points}</p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {item.cards.map((card) => <PlayingCard key={card} card={card} width={28} prefs={prefs} />)}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </dialog>
    </>
  );
}
