"use client";

import { useId, useState } from "react";
import type { PlayerView } from "@/engine/types";
import { useCardPrefs } from "@/lib/cardPrefs";
import { coachLines } from "./coach";

/** A suggestion the coach can act on: an engine Advice, or a practice step such as starting play. */
export interface CoachStep {
  headline: string;
  reason: string;
  /** label for the button that performs it */
  act: string;
  run: () => void;
  /** true when the suggestion outlines cards in the hand */
  marks: boolean;
}

/** The legend for suggested cards: a small card drawn the way suggested cards are outlined in the hand. */
function Mark() {
  return (
    <span aria-hidden className="relative mt-[5px] inline-block h-[18px] w-[13px] shrink-0 rounded-[3px] border-[1.5px] border-dashed border-chalk">
      <span className="absolute -top-[6px] left-[2px] h-[3px] w-[3px] rounded-full bg-chalk" />
    </span>
  );
}

/**
 * Chalk-on-cloth coaching: a left column on desktop, a one-row strip on phones. On a phone the
 * headline is the toggle: tap it to see why, the rules notes and Start over. Sideways on a phone
 * the board needs the whole screen, so the coach floats in the top left corner over the table.
 */
export function Coach({ view, autoMeld, step, onStartOver }: {
  view: PlayerView; autoMeld: boolean; step: CoachStep | null; onStartOver: () => void;
}) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const { short } = useCardPrefs();
  const lines = coachLines(view, autoMeld);
  const title = step ? step.headline : lines[0];
  const rest = step ? [step.reason, ...lines] : lines.slice(1);
  const heading = (
    <>
      {step?.marks && <Mark />}
      <span className={step ? "display text-chalk" : `text-[15px] leading-normal text-chalk ${open ? "" : "line-clamp-2"} lg:line-clamp-none`} style={step ? { fontSize: 21, lineHeight: 1.25 } : undefined}>{title}</span>
    </>
  );

  if (short) {
    return (
      <aside aria-label="Coaching" className="fixed left-2 top-1.5 z-30 max-w-[min(46vw,26rem)]">
        <div aria-live="polite" className="flex items-center gap-2">
          <button type="button" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((o) => !o)}
            className="flex min-h-9 min-w-0 flex-1 items-center gap-1.5 rounded-full bg-black/35 px-3 text-left backdrop-blur-sm">
            {step?.marks && <Mark />}
            <span className={`truncate text-sm ${step ? "display text-chalk" : "text-chalk"}`} style={step ? { fontSize: 17 } : undefined}>{title}</span>
            <span aria-hidden className="ml-auto shrink-0 pl-1 text-xs text-chalk-faint">{open ? "Less" : step ? "Why" : "More"}</span>
          </button>
          {step && <button type="button" className="btn btn-brass btn-compact shrink-0" style={{ height: "2.25rem" }} onClick={step.run}>{step.act}</button>}
        </div>
        <div id={bodyId} className={`${open ? "block" : "hidden"} panel mt-1.5 max-h-[calc(100dvh-4rem)] overflow-y-auto px-3 py-2 text-sm text-ink`}>
          <div className="space-y-1.5 leading-normal">
            {rest.map((l, i) => <p key={`${view.phase}-${i}`} className={step && i === 0 ? "" : "text-ink-soft"}>{l}</p>)}
          </div>
          <button type="button" className="tap-link -ml-2 text-sm text-ink-soft underline-offset-4 hover:text-ink hover:underline" onClick={onStartOver}>Start over</button>
        </div>
      </aside>
    );
  }

  return (
    <aside aria-label="Coaching" className="px-4 pb-1 lg:sticky lg:top-6 lg:self-start lg:px-0 lg:pb-0 lg:pt-6">
      <h1 className="display sr-only lg:not-sr-only" style={{ fontSize: 28 }}>Learn as you go</h1>
      <div aria-live="polite" className="flex items-center gap-3 lg:mt-4 lg:flex-col lg:items-start">
        <button type="button" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((o) => !o)}
          className="flex min-h-11 min-w-0 flex-1 items-start gap-2 text-left lg:hidden">
          {heading}
          <span aria-hidden className="ml-auto mt-[3px] shrink-0 pl-1 text-sm text-chalk-faint">{open ? "Less" : step ? "Why" : "More"}</span>
        </button>
        <p className="hidden items-start gap-2 lg:flex">{heading}</p>
        {step && <p className="hidden max-w-[36em] text-[15px] leading-normal text-chalk lg:block">{step.reason}</p>}
        {step && <button type="button" className="btn btn-brass btn-compact shrink-0" onClick={step.run}>{step.act}</button>}
      </div>
      <div id={bodyId} className={`${open ? "block" : "hidden"} lg:block`}>
        <div className="mt-1 max-w-[36em] space-y-2 text-[15px] leading-normal lg:mt-4">
          {rest.map((l, i) => (
            <p key={`${view.phase}-${i}`} className={step && i === 0 ? "text-chalk lg:hidden" : "text-chalk-faint"}>{l}</p>
          ))}
        </div>
        <button type="button" className="tap-link -ml-2 text-sm text-chalk-faint underline-offset-4 hover:text-chalk hover:underline lg:mt-2" onClick={onStartOver}>
          Start over
        </button>
      </div>
    </aside>
  );
}
