"use client";

import { useId, useState } from "react";
import type { PlayerView } from "@/engine/types";
import { coachLines } from "./coach";

/** Chalk-on-cloth coaching: a left column on desktop, a collapsible strip on phones. */
export function Coach({ view, canLay, autoMeld, onLayDown, onStartOver }: {
  view: PlayerView; canLay: boolean; autoMeld: boolean; onLayDown: () => void; onStartOver: () => void;
}) {
  const [open, setOpen] = useState(true);
  const bodyId = useId();
  const lines = coachLines(view, autoMeld);

  return (
    <aside aria-label="Coaching" className="px-4 pb-3 pt-4 lg:sticky lg:top-6 lg:self-start lg:px-0 lg:pb-0 lg:pt-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="display" style={{ fontSize: 28 }}>Learn as you go</h1>
        <button type="button" className="tap-link -mr-2 text-sm text-chalk-faint underline-offset-4 hover:text-chalk hover:underline lg:hidden"
          aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((o) => !o)}>
          {open ? "Hide" : "Show"}
        </button>
      </div>
      <div id={bodyId} className={`${open ? "block" : "hidden"} lg:block`} aria-live="polite">
        <div className="mt-3 max-w-[36em] space-y-2 text-[15px] leading-normal">
          {lines.map((l, i) => <p key={`${view.phase}-${i}`} className={i === 0 ? "text-chalk" : "text-chalk-faint"}>{l}</p>)}
        </div>
      </div>
      {canLay && (
        <button type="button" className="btn btn-brass mt-4" onClick={onLayDown}>Lay down all my meld</button>
      )}
      <div className={canLay ? "mt-1" : "mt-2"}>
        <button type="button" className="tap-link -ml-2 text-sm text-chalk-faint underline-offset-4 hover:text-chalk hover:underline" onClick={onStartOver}>
          Start over
        </button>
      </div>
    </aside>
  );
}
