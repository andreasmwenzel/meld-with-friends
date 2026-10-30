"use client";

import { useId } from "react";
import { useCardPrefs, type CardSize, type MotionPref } from "@/lib/cardPrefs";
import { useOpponentPointsPref } from "@/lib/prefs";
import { suitSequence, type HandSortPrefs, type RankDirection, type SuitOrder, type TrumpPlacement } from "@/engine/hand";
import type { Suit } from "@/engine/types";
import { SUIT_GLYPH, SUIT_NAME, suitInk } from "@/components/cards/PlayingCard";

function Row({ label, children, stacked = false, description }: { label: string; children: React.ReactNode; stacked?: boolean; description?: string }) {
  const descriptionId = useId();
  return (
    <div className={stacked ? "flex flex-col gap-1" : "flex flex-wrap items-center justify-between gap-x-4 gap-y-1"}>
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
const PLACEMENTS: [TrumpPlacement, string][] = [["left", "Left"], ["right", "Right"], ["off", "Off"]];
const SUIT_ORDERS: [SuitOrder, string][] = [["fixed", "Fixed order"], ["alternating", "Alternate colours"]];
const RANKS: [RankDirection, string][] = [["high-first", "High to low"], ["low-first", "Low to high"]];
/** Shown when no trump is named yet, so the preview still says where trump would go. */
const EXAMPLE_TRUMP: Suit = "H";

/** The suits left to right as the hand will lay out, trump shaded as it is in the hand. */
function OrderPreview({ sort, trump, fourColour, tint }: { sort: HandSortPrefs; trump: Suit | null; fourColour: boolean; tint: boolean }) {
  const shown = trump ?? EXAMPLE_TRUMP;
  const suits = suitSequence(shown, sort);
  const trumpName = SUIT_NAME[shown][0].toUpperCase() + SUIT_NAME[shown].slice(1);
  const words = suits.map((suit) => SUIT_NAME[suit]).join(", ");
  return (
    <div className="flex items-center gap-3">
      <div aria-hidden className="flex shrink-0 gap-1">
        {suits.map((suit) => (
          <span key={suit} style={{ color: suitInk(suit, fourColour) }}
            className={`flex h-[30px] w-[22px] items-center justify-center rounded-[3px] text-[15px] leading-none shadow-[0_0_0_1px_rgba(36,29,29,.18)] ${tint && suit === shown ? "bg-chalk-trump" : "bg-chalk"}`}>
            {SUIT_GLYPH[suit]}
          </span>
        ))}
      </div>
      <p className="text-xs text-ink-soft">
        <span className="sr-only">Left to right: {words}. </span>
        {trump ? `${trumpName} are trump` : `If ${SUIT_NAME[shown]} were trump`}; {sort.ranks === "high-first" ? "aces" : "nines"} first in each suit.
      </p>
    </div>
  );
}

/** Every card and table preference, as rows of pills. The table's menu shows it inline. */
export function CardOptionsPanel({ trump = null }: { trump?: Suit | null }) {
  const { prefs, size, update } = useCardPrefs();
  const sort = (patch: Partial<HandSortPrefs>) => update({ sort: { ...prefs.sort, ...patch } });
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
      <Row label="Trump tint">
        <Pill on={prefs.trumpTint} onClick={() => update({ trumpTint: true })}>On</Pill>
        <Pill on={!prefs.trumpTint} onClick={() => update({ trumpTint: false })}>Off</Pill>
      </Row>
      <Row label="Tap twice to play" stacked description={prefs.confirmPlay ? "The first tap lifts a card. Tap it again quickly to play it, or later to put it back." : "A tap plays the card."}>
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
      <div role="group" aria-label="Hand order" className="flex flex-col gap-2.5">
        <p className="text-sm text-ink-soft">Hand order</p>
        <Row label="Trump" stacked>
          {PLACEMENTS.map(([placement, label]) => <Pill key={placement} on={prefs.sort.trump === placement} onClick={() => sort({ trump: placement })}>{label}</Pill>)}
        </Row>
        <Row label="Other suits" stacked>
          {SUIT_ORDERS.map(([suits, label]) => <Pill key={suits} on={prefs.sort.suits === suits} onClick={() => sort({ suits })}>{label}</Pill>)}
        </Row>
        <Row label="Card order" stacked>
          {RANKS.map(([ranks, label]) => <Pill key={ranks} on={prefs.sort.ranks === ranks} onClick={() => sort({ ranks })}>{label}</Pill>)}
        </Row>
        <OrderPreview sort={prefs.sort} trump={trump} fourColour={prefs.fourColour} tint={prefs.trumpTint} />
      </div>
    </>
  );
}
