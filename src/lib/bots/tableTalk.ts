import type { HandRecord, SeatIndex, Team } from "@/engine/types";

/** Deliberately excludes hands, passes, revealed cards, deal seeds and private views. */
export interface TalkFacts {
  hand: HandRecord;
  score: Record<Team, number>;
  winner: Team | null;
  minBid: number;
  scale: number;
}
export interface TalkSeat { seat: SeatIndex; name: string; bot: boolean }
export type TalkSituation = keyof typeof lines;

export const lines = {
  selfMade: [
    "Bid paid! I'll take that little sigh of relief.",
    "We made it, partner. My eyebrows can come down now.",
    "That bid found its way home.",
    "A made bid and good company. That'll do.",
    "We got there, partner. Tea tastes better after that.",
    "Contract delivered. No postage due.",
    "Our bid came in with its shoes still on.",
    "Made it! I can stop counting on my fingers.",
  ],
  partnerMade: [
    "Nice bid, {bidder}. Happy to ride along.",
    "You brought that one home, {bidder}.",
    "Well played, {bidder}. I'd partner you again.",
    "That's our bid in the bank, {bidder}.",
    "Nicely steered, {bidder}. I barely spilled my tea.",
    "Good work, {bidder}. Worth the price of admission.",
    "A tidy finish, {bidder}. Take a bow.",
    "Made it, {bidder}! I'll handle the applause.",
  ],
  ownSet: [
    "We went set. Still plenty of chairs at this table.",
    "That bid took the scenic route. We'll try again.",
    "Set this time. The kettle's still warm, partner.",
    "Oof, partner. Let's call that tuition.",
    "Our bid didn't quite stretch. Happens to all of us.",
    "One set won't spoil the evening.",
    "We'll leave that bid in the rearview mirror.",
    "Ah well, partner. Even good pies fall flat sometimes.",
  ],
  opponentMade: [
    "Big bid, {bidder}. Nicely brought home.",
    "You earned that one, {bidder}. Hats off.",
    "That's a tall bid to carry, {bidder}. Well played.",
    "Well, {bidder}, that bid had legs.",
    "A big promise kept, {bidder}. I respect it.",
    "Made the big bid! Save some applause for {bidder}.",
    "That was quite a climb, {bidder}. Good footing.",
    "Nicely done, {bidder}. My tea went cold watching.",
  ],
  opponentSmallMade: [
    "Nicely made, {bidder}. A bid in the bank.",
    "You brought it home, {bidder}. Well played.",
    "A tidy contract, {bidder}. Hats off.",
    "That bid paid its way, {bidder}.",
    "Well done, {bidder}. The score pencil approves.",
    "Made it, {bidder}. I'll supply the polite applause.",
    "A bid well kept, {bidder}. Lovely work.",
    "Good finish, {bidder}. Time to sharpen my pencil.",
  ],
  opponentSet: [
    "Nice set, {partner}. That'll keep the pencil busy.",
    "We held that bid, partner. Nicely done.",
    "A set for us. I'll take a small victory lap.",
    "Good teamwork, {partner}. That bid stayed put.",
    "We found a little breathing room with that set.",
    "That set deserves a fresh cup of tea, partner.",
    "A tidy bit of defending, {partner}.",
    "Good defense, partner. Back to the score pad.",
  ],
  shootMade: [
    "The moon! Someone fetch a bigger score pad.",
    "All the tricks. That's a moon worth looking up for.",
    "Moon made! I brought applause, not a telescope.",
    "Every trick accounted for. What a moon shot.",
    "A clean trip to the moon. Lovely work.",
    "Moon landed. Please return your trays upright.",
    "All twelve! That calls for the good biscuits.",
    "A made moon. I'll be talking about that over tea.",
  ],
  shootMissed: [
    "The moon was a little far tonight. Brave try.",
    "Moon missed. Still glad we got to watch the attempt.",
    "That moon shot came back to earth. Good company here.",
    "A missed moon. Ambition gets a nod from me.",
    "The moon kept its distance this time.",
    "A bold trip, even without the moon landing.",
    "Moon missed. Put the telescope away and pour some tea.",
    "No moon tonight. Thanks for giving it a go.",
  ],
  bigMeld: [
    "That meld needed its own end of the table.",
    "Quite a pile of meld. My pencil needs a rest.",
    "Big meld! Someone brought the fancy stationery.",
    "That much meld deserves a second look at the score pad.",
    "A generous helping of meld on that one.",
    "That meld could pay rent around here.",
    "Well now, that's a proper stack of meld.",
    "Big meld on the board. Pass the counting fingers.",
  ],
  leading: [
    "We've got a cushion, partner. I'll try not to nap on it.",
    "A nice lead for us. Plenty of cards left to play.",
    "Our score's looking cheerful, partner.",
    "We've a little wind in our sails now.",
    "We're ahead, partner. Keep the kettle on.",
    "A roomy lead. I still won't put my pencil away.",
    "We're doing nicely. One hand at a time, partner.",
    "Our end of the score pad is filling up.",
  ],
  trailing: [
    "We've some catching up to do. I'll keep my chair.",
    "A steep hill, partner. Good thing we're sitting down.",
    "We're behind. Plenty of room for a good story yet.",
    "Our score could use a biscuit, partner.",
    "A bit to catch up, partner. I'm still enjoying the company.",
    "We're chasing the score. At least there's no running.",
    "A long way back, partner. One bid at a time.",
    "Our pencil's had a quiet night. Let's wake it up.",
  ],
  win: [
    "That's our game, partner. Thanks for a lovely table.",
    "We got there! Good game, everyone.",
    "A win for us. I'd happily sit with this table again.",
    "Game to us, partner. You can have the last biscuit.",
    "We won! I'll try to keep my victory dance seated.",
    "Our game. Thanks for making us work for it.",
    "A lovely finish for us. Well played, all.",
    "We made the finish line, partner. Good game.",
  ],
  loss: [
    "Your game. Well played, and thanks for the company.",
    "You got us. A pleasure sharing the table.",
    "Good game! I'll claim the silver medal and a biscuit.",
    "A well-earned win for your side. Same chairs next time?",
    "Your game tonight. My hat's off to you both.",
    "We came second in a very pleasant evening.",
    "Good game, everyone. I enjoyed the chase.",
    "You crossed the line first. I'll bring tea next time.",
  ],
  redeal: [
    "Fresh deal. The shuffle gets an encore.",
    "Back to the shuffle. My tea can wait.",
    "A redeal! The cards wanted another dance.",
    "Throw that one back. Let's see what the shuffle brings.",
    "New deal, same good company.",
    "The dealer gets a little extra exercise.",
    "A fresh start. Even the cards get a second chance.",
    "Redealing. I'll give the score pencil a breather.",
  ],
  rematch: [
    "Another round? I've already warmed up my chair.",
    "Same table, fresh score pad. Deal me in.",
    "A rematch! I'll put another kettle on.",
    "Back for more. Someone guard the biscuits.",
    "Fresh game, familiar faces. My kind of evening.",
    "Another game. I wasn't done sitting here anyway.",
    "Rematch accepted. My victory dance needs practice.",
    "Round two! The score pad gets a clean slate.",
  ],
} as const;

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

/** All variety comes from an independent seed, never the engine's shuffle seed. */
export function pickLine(situation: TalkSituation, seed: string, names: { bidder: string; partner: string }): string {
  const choices = lines[situation];
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
  }) };
}
