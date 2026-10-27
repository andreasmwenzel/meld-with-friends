// Screen reader announcements built from the engine's public log. Pure, so it can be tested without a browser.
import type { CardId, SeatIndex } from "@/engine/types";
import { cardName } from "@/components/cards/PlayingCard";

const SEATS = ["South", "West", "North", "East"] as const;
const SUIT_OF: Record<string, string> = { "♠": "S", "♥": "H", "♦": "D", "♣": "C" };
// Third-person verbs the engine log uses, and their form after "You".
const YOU_VERB: Record<string, string> = {
  bids: "bid", passes: "pass", plays: "play", takes: "take", declares: "declare", melds: "meld",
  confirms: "confirm", shoots: "shoot", claims: "claim", throws: "throw", wins: "win", deals: "deal", redeals: "redeal", is: "are",
};

/**
 * Lines appended to the log since `prev`. The log is capped, so old lines fall off the front;
 * find the shortest tail of `next` that, once removed, leaves something `prev` ends with.
 */
export function newLogLines(prev: readonly string[], next: readonly string[]): string[] {
  for (let fresh = 0; fresh <= next.length; fresh++) {
    const kept = next.slice(0, next.length - fresh);
    const tail = prev.slice(Math.max(0, prev.length - kept.length));
    if (kept.length <= prev.length && kept.every((line, i) => line === tail[i])) return next.slice(next.length - fresh);
  }
  return [...next];
}

/** "West plays 10♥" becomes "Margaret plays ten of hearts"; your own seat becomes "You play ...". */
export function speakLine(line: string, nameOf: (seat: SeatIndex) => string): string {
  let out = line.replace(/\b(10|[AKQJ9])([♠♥♦♣])/g, (_m, rank: string, glyph: string) =>
    cardName(`${rank === "10" ? "T" : rank}${SUIT_OF[glyph]}0` as CardId));
  // A seat starting the line or a clause ("Hand 2: East deals", "...; North redeals") is the subject of its verb.
  out = out.replace(/(^|[:;] )(South|West|North|East)\b( \w+)?/g, (_m, lead: string, seat: string, verb?: string) => {
    const who = nameOf(SEATS.indexOf(seat as (typeof SEATS)[number]) as SeatIndex);
    const v = verb?.trim();
    const you = lead.startsWith(";") ? "you" : "You";
    return lead + (who === "You" ? (v && YOU_VERB[v] ? `${you} ${YOU_VERB[v]}` : `${you}${verb ?? ""}`) : `${who}${verb ?? ""}`);
  });
  // Seat names later in the sentence ("passes 4 cards to East", "takes the trick" winners) become names too.
  out = out.replace(/\b(to|for) (South|West|North|East)\b/g, (_m, prep: string, seat: string) => {
    const who = nameOf(SEATS.indexOf(seat as (typeof SEATS)[number]) as SeatIndex);
    return `${prep} ${who === "You" ? "you" : who}`;
  });
  return out;
}
