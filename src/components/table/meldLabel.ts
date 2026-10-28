import type { MeldItem } from "@/engine/types";
import { SUIT_GLYPH, splitCard } from "@/components/cards/PlayingCard";

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
