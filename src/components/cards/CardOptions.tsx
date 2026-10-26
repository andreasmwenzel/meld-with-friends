"use client";

import { useId } from "react";
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

/** Every card and table preference, as rows of pills. The table's menu shows it inline. */
export function CardOptionsPanel() {
  const { prefs, size, update } = useCardPrefs();
  const { hideOpponentPoints, setHideOpponentPoints } = useOpponentPointsPref();
  return (
    <>
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
    </>
  );
}
