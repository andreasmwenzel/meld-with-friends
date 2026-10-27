import type { HandRecord, SeatIndex, Team } from "@/engine/types";
import { botVoices, neutralVoice, type BotName, type TalkSituation, type Voice } from "./tableTalkLines";

/** Deliberately excludes hands, passes, revealed cards, deal seeds and private views. */
export interface TalkFacts {
  hand: HandRecord;
  score: Record<Team, number>;
  winner: Team | null;
  minBid: number;
  scale: number;
}
export interface TalkSeat { seat: SeatIndex; name: string; bot: boolean }
export type { TalkSituation, Voice } from "./tableTalkLines";
export { SITUATIONS, botVoices, neutralVoice } from "./tableTalkLines";

/** Each bot speaks in its own voice; any other name gets the neutral one. */
export function voiceFor(speaker: string): Voice {
  return Object.hasOwn(botVoices, speaker) ? botVoices[speaker as BotName] : neutralVoice;
}

function hash(seed: string): number {
  let value = 2166136261;
  for (const char of seed) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  return value >>> 0;
}

/** Alternating gaps of three and four deals, including throw-ins. First deal stays quiet. */
export function talkDue(tableId: string, handNumber: number): boolean {
  const first = 3 + hash(tableId) % 2;
  return handNumber >= first && (handNumber % 7 === first || handNumber % 7 === 0);
}

const teamOf = (seat: SeatIndex): Team => seat % 2 === 0 ? "red" : "blue";

export function talkSituations(facts: TalkFacts, bot: SeatIndex): TalkSituation[] {
  const { hand, score, winner, scale, minBid } = facts;
  const ours = teamOf(bot);
  const theirs = ours === "red" ? "blue" : "red";
  if (hand.shotMade !== undefined) return [hand.shotMade ? "shootMade" : "shootMissed"];
  if (winner) return [winner === ours ? "win" : "loss"];
  const situations: TalkSituation[] = [];
  if (Math.max(hand.meld.red, hand.meld.blue) >= 400 * scale) situations.push("bigMeld");
  if (Math.abs(score.red - score.blue) >= 750 * scale) situations.push(score[ours] > score[theirs] ? "leading" : "trailing");
  if (teamOf(hand.bidder) === ours) {
    situations.push(hand.wentSet ? "ownSet" : hand.bidder === bot ? "selfMade" : "partnerMade");
  } else if (hand.wentSet) situations.push("opponentSet");
  else situations.push(hand.bid >= minBid * 2 ? "opponentMade" : "opponentSmallMade");
  return situations;
}

/** All variety comes from an independent seed, never the engine's shuffle seed. `speaker` picks the voice. */
export function pickLine(situation: TalkSituation, seed: string, names: { bidder: string; partner: string }, speaker = ""): string {
  const choices = voiceFor(speaker)[situation];
  // Bound public display names before substitution so every message stays below 80 characters.
  const name = (value: string) => {
    let result = "";
    for (const char of value.replace(/[\r\n\t]/g, " ")) {
      if (result.length + char.length > 16) break;
      result += char;
    }
    return result;
  };
  return choices[hash(seed) % choices.length].replaceAll("{bidder}", name(names.bidder)).replaceAll("{partner}", name(names.partner));
}

export function pickTableTalk(seats: TalkSeat[], seed: string, facts: TalkFacts | "redeal" | "rematch") {
  const bots = seats.filter(s => s.bot).sort((a, b) => a.seat - b.seat);
  if (!bots.length) return null;
  const bot = bots[hash(`${seed}:speaker`) % bots.length];
  const situations = typeof facts === "string" ? [facts] : talkSituations(facts, bot.seat);
  if (!situations.length) return null;
  const situation = situations[hash(`${seed}:situation`) % situations.length];
  const findName = (seat: number, fallback: string) => seats.find(s => s.seat === seat)?.name || fallback;
  return { seat: bot.seat, name: bot.name, text: pickLine(situation, `${seed}:line`, {
    bidder: typeof facts === "string" ? "friend" : findName(facts.hand.bidder, "friend"),
    partner: findName((bot.seat + 2) % 4, "partner"),
  }, bot.name) };
}
