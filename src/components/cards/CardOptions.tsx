"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useCardPrefs, type CardSize, type MotionPref } from "@/lib/cardPrefs";
import { useOpponentPointsPref } from "@/lib/prefs";
import type { HandSortOrder, RankDirection } from "@/engine/hand";

function Row({ label, children, stacked = false, description }: { label: string; children: React.ReactNode; stacked?: boolean; description?: string }) {
  const descriptionId = useId();
  return (
    <div className={stacked ? "flex flex-col gap-1" : "flex items-center justify-between gap-4"}>
      <span className="text-sm text-ink-soft">{label}</span>
      <div role="group" aria-label={label} aria-describedby={description ? descriptionId : undefined} className="flex gap-1 rounded-full bg-chalk-dim p-0.5 text-sm">{children}</div>
      {description && <p id={descriptionId} className="text-xs text-ink-soft">{description}</p>}
    </div>
  );
}

function Pill({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick}
      className={`rounded-full px-3 py-1 ${on ? "bg-ink text-chalk" : "text-ink-soft"}`}>
      {children}
    </button>
  );
}

const MOTIONS: [MotionPref, string][] = [["normal", "Normal"], ["quick", "Quick"], ["off", "Off"]];
const SIZES: [CardSize, string][] = [["s", "S"], ["m", "M"], ["l", "L"]];
const ORDERS: [HandSortOrder, string][] = [["trump-first", "Trump first"], ["suits", "By suit"], ["alternating", "Alternate colours"]];
const RANKS: [RankDirection, string][] = [["high-first", "High to low"], ["low-first", "Low to high"]];

/** The "Cards" text button for the seat line, with a chalk popover above it. */
export function CardOptions() {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  // Horizontal nudge (px) that keeps the panel inside the viewport when the
  // button sits near an edge, which is the normal case on a phone.
  const [shift, setShift] = useState(0);
  const { prefs, size, update } = useCardPrefs();
  const { hideOpponentPoints, setHideOpponentPoints } = useOpponentPointsPref();

  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", down); document.removeEventListener("keydown", key); };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = box.current?.getBoundingClientRect();
      const width = panel.current?.offsetWidth ?? 0;
      if (!anchor || !width) return;
      const margin = 12;
      const centre = anchor.left + anchor.width / 2;
      const left = centre - width / 2;
      const right = centre + width / 2;
      const max = window.innerWidth - margin;
      setShift(left < margin ? margin - left : right > max ? max - right : 0);
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);

  return (
    <span ref={box} className="relative inline-block">
      <button type="button" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((o) => !o)} className="tap-link underline hover:text-chalk">Cards</button>
      {open && (
        <div ref={panel} role="dialog" aria-label="Card options"
          style={{ transform: `translateX(calc(-50% + ${shift}px))` }}
          className="panel absolute bottom-full left-1/2 z-30 mb-2 flex w-64 max-w-[calc(100vw-1.5rem)] flex-col gap-2.5 p-3 text-left">
          <Row label="Deck">
            <Pill on={!prefs.fourColour} onClick={() => update({ fourColour: false })}>Standard</Pill>
            <Pill on={prefs.fourColour} onClick={() => update({ fourColour: true })}>Four-colour</Pill>
          </Row>
          <Row label="Index">
            <Pill on={!prefs.bigIndex} onClick={() => update({ bigIndex: false })}>Regular</Pill>
            <Pill on={prefs.bigIndex} onClick={() => update({ bigIndex: true })}>Big</Pill>
          </Row>
          <Row label="Size">
            {SIZES.map(([s, l]) => <Pill key={s} on={size === s} onClick={() => update({ size: s })}>{l}</Pill>)}
          </Row>
          <Row label="Tap twice to play">
            <Pill on={prefs.confirmPlay} onClick={() => update({ confirmPlay: true })}>On</Pill>
            <Pill on={!prefs.confirmPlay} onClick={() => update({ confirmPlay: false })}>Off</Pill>
          </Row>
          <Row label="Meld" stacked description={prefs.autoMeld ? "Your best meld is laid down for you." : "Pick your meld cards and lay them down. Cards that score are outlined."}>
            <Pill on={prefs.autoMeld} onClick={() => update({ autoMeld: true })}>Automatic</Pill>
            <Pill on={!prefs.autoMeld} onClick={() => update({ autoMeld: false })}>Pick my own</Pill>
          </Row>
          <Row label="Opponent points" stacked description="Always shown when the hand ends.">
            <Pill on={!hideOpponentPoints} onClick={() => setHideOpponentPoints(false)}>Shown</Pill>
            <Pill on={hideOpponentPoints} onClick={() => setHideOpponentPoints(true)}>Hidden</Pill>
          </Row>
          <Row label="Motion" stacked description="Off also follows your device's reduced-motion setting.">
            {MOTIONS.map(([motion, label]) => <Pill key={motion} on={prefs.motion === motion} onClick={() => update({ motion })}>{label}</Pill>)}
          </Row>
          <div role="group" aria-label="Sorting" className="flex flex-col gap-2.5">
            <p className="text-sm text-ink-soft">Sorting</p>
            <Row label="Order" stacked description="Trump moves to the left once it is named.">
              {ORDERS.map(([order, label]) => <Pill key={order} on={prefs.sort.order === order} onClick={() => update({ sort: { ...prefs.sort, order } })}>{label}</Pill>)}
            </Row>
            <Row label="Ranks" stacked>
              {RANKS.map(([ranks, label]) => <Pill key={ranks} on={prefs.sort.ranks === ranks} onClick={() => update({ sort: { ...prefs.sort, ranks } })}>{label}</Pill>)}
            </Row>
          </div>
        </div>
      )}
    </span>
  );
}
