"use client";

import { useId, useState } from "react";
import type { HandRecap, SeatIndex, Suit } from "@/engine/types";
import { PlayingCard, splitCard } from "@/components/cards/PlayingCard";
import { useCardPrefs } from "@/lib/cardPrefs";

/** Browse completed public tricks without changing the live board or its turn. */
export function TrickReview({ tricks, trump, seat, nameOf }: {
  tricks: HandRecap["tricks"]; trump: Suit | null; seat: SeatIndex; nameOf: (seat: SeatIndex) => string;
}) {
  const [selected, setSelected] = useState(() => tricks.at(-1)?.index ?? 1);
  const { prefs } = useCardPrefs();
  const heading = useId();
  const position = Math.max(0, tricks.findIndex((trick) => trick.index === selected));
  const trick = tricks[position];
  if (!trick) return <p className="text-sm text-ink-soft">No completed tricks yet.</p>;
  const spots = ["col-start-2 row-start-3", "col-start-1 row-start-2", "col-start-2 row-start-1", "col-start-3 row-start-2"];

  return (
    <section aria-labelledby={heading} className="mt-3 rounded-lg border border-chalk-dim p-3">
      <h3 id={heading} className="text-sm font-semibold">Review completed tricks</h3>
      <div className="mt-2 flex items-center justify-between gap-2">
        <button type="button" className="btn btn-ink btn-compact" aria-label="Previous trick" disabled={position === 0}
          onClick={() => setSelected(tricks[position - 1].index)}>Previous</button>
        <p role="status" className="text-center text-xs tabular-nums">Trick {trick.index} of {tricks.length}</p>
        <button type="button" className="btn btn-ink btn-compact" aria-label="Next trick" disabled={position === tricks.length - 1}
          onClick={() => setSelected(tricks[position + 1].index)}>Next</button>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2" role="group" aria-label={`Cards in trick ${trick.index}`}>
        {trick.plays.map((play) => (
          <div key={play.seat} className={`flex min-w-0 flex-col items-center gap-1 ${spots[(play.seat - seat + 4) % 4]}`}>
            <p className="w-full break-words text-center text-xs">{nameOf(play.seat)}</p>
            <PlayingCard card={play.card} width={48} prefs={prefs} trump={splitCard(play.card).suit === trump} selected={play.seat === trick.winner} />
            <p className="min-h-4 text-center text-xs text-ink-soft">
              {[play.seat === trick.leader && "Led", play.seat === trick.winner && "Won"].filter(Boolean).join(" · ")}
            </p>
          </div>
        ))}
      </div>
      <p className="mt-2 text-center text-xs text-ink-soft">
        {nameOf(trick.leader)} led. {nameOf(trick.winner)} won. {trick.counters} counter points.
      </p>
    </section>
  );
}
