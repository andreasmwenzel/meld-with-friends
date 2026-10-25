import { splitCard } from "@/components/cards/PlayingCard";
import { computeMeld } from "@/engine/meld";
import { describeConstraint } from "@/engine/rules";
import type { PlayerView, SeatIndex, Suit } from "@/engine/types";

export const PRACTICE_NAMES: Record<SeatIndex, string> = { 0: "You", 1: "Margaret", 2: "Walt", 3: "June" };

const SUIT_WORD: Record<Suit, string> = { S: "spades", H: "hearts", D: "diamonds", C: "clubs" };
const SUITS: Suit[] = ["S", "H", "C", "D"];

const nm = (s: SeatIndex) => PRACTICE_NAMES[s];
const signed = (n: number) => (n >= 0 ? `up ${n}` : `down ${-n}`);

/** Short, specific coaching for whatever the learner is looking at right now. */
export function coachLines(view: PlayerView, autoMeld = true): string[] {
  const L = view.legal;
  const trump = view.trump ? SUIT_WORD[view.trump] : null;
  const bidder = view.bidder;

  switch (view.phase) {
    case "dealing":
      return ["The cards are going out."];

    case "bidding": {
      const hi = view.highBid;
      const standing = hi && hi.amount !== null ? `${nm(hi.seat)} ${hi.seat === 0 ? "are" : "is"} high at ${hi.amount}.` : view.bids.filter((b) => b.amount === null).length >= 3 ? "The other three passed, so the bid falls to you." : "Nobody has bid yet.";
      if (L.canBid || L.canPassBid) {
        return [
          `A bid is a promise that your side, you and Walt, will score at least that many points this hand. ${standing} The lowest you can say is ${L.minBid ?? "a pass"}.`,
          "The “Your meld” line under your cards shows what this hand is worth on its own. Tricks and your partner add the rest.",
        ];
      }
      return [`The bidding is going around the table. ${standing}`, "A bid is a promise to score that many points, meld and tricks together. Watch how high the others go."];
    }

    case "declaring_trump": {
      if (L.canDeclareTrump) {
        const counts = SUITS.map((s) => [s, view.hand.filter((c) => splitCard(c).suit === s).length] as const).sort((a, b) => b[1] - a[1]);
        const [best, n] = counts[0];
        return [
          `You won the bidding at ${view.highBid?.amount}, so you name trump. Trump is the suit that beats every other suit for this hand.`,
          `You hold ${n} ${SUIT_WORD[best]}, more than any other suit. Naming it is a sound choice, and it is usually where the meld is.`,
        ];
      }
      return [`${bidder !== null ? nm(bidder) : "The high bidder"} won at ${view.highBid?.amount} and is choosing trump. Trump is the suit that beats every other suit this hand.`];
    }

    case "passing_to_bidder":
    case "passing_back": {
      const n = L.mustPassCount;
      if (n !== null && view.phase === "passing_to_bidder") {
        return [
          `Walt bid, and ${trump} is trump. Pick ${n} cards to send him, then confirm.`,
          `Send what helps him most: aces, tens, kings and ${trump} you can spare, or cards that finish a meld for him. Keep what helps you.`,
        ];
      }
      if (n !== null) {
        return [
          `Walt sent you ${n} cards. Now send ${n} back to him.`,
          `Pass the cards that do the least for you outside ${trump}. Do not give up trump you need.`,
        ];
      }
      if (bidder === 0 || bidder === 2) {
        return ["Walt is choosing cards to send " + (view.phase === "passing_to_bidder" ? "you." : "back to you."), "Partners swap cards after the bid so the bidder has a better hand to keep the promise with."];
      }
      return ["The other side is swapping cards, bidder and partner. You have nothing to do but watch."];
    }

    case "melding": {
      const total = view.trump ? computeMeld(view.hand, view.trump, view.rules).total : 0;
      if (view.meldConfirmed[0]) return ["Your meld is down. Once everyone has melded, the table shows each player’s meld before the first lead."];
      return [
        `Meld is a set of card combinations that count points before a single trick is played. Lay everything down and the table counts it for you. This hand is worth ${total} with ${trump} as trump.`,
        autoMeld
          ? "Declaring all of it is always right, so the table lays it down for you. To pick cards yourself, switch Meld to Pick my own under Cards."
          : "Declaring all of it is always right. The brass-outlined cards are the ones that score; Do this lays them all down and confirms.",
      ];
    }

    case "playing": {
      const c = L.playConstraint;
      if (view.turn === 0 && c) {
        const line = describeConstraint(c, SUIT_WORD);
        const n = L.playableCards.length;
        const why: Record<typeof c.reason, string> = {
          lead_any: "You are leading the trick, so you choose. An ace or a trump is a strong way to open.",
          any: "You may play whatever you like here.",
          follow_suit: "If you have the suit that was led, you must play it, and if you can beat the best card on the table you have to. That is heading the trick.",
          must_head: "You have the suit, so you must play a card that beats what is winning. That is heading the trick.",
          must_trump: `You are out of the suit that was led, so ${trump} is your weapon. Trump when you are void, and take the trick.`,
          must_overtrump: `Someone has already trumped, so you must go higher in ${trump} if you can.`,
        };
        return [`${line} ${n === 1 ? "One card is legal." : `${n} of your cards are legal.`}`, why[c.reason]];
      }
      const who = view.turn !== null ? nm(view.turn) : "Someone";
      return [`${who} to play. ${trump ? `${trump[0].toUpperCase()}${trump.slice(1)} are trump.` : ""}`.trim(), "Each trick goes to the highest trump, or failing that the highest card of the suit led. Winners lead the next trick."];
    }

    case "hand_over": {
      const rec = view.history[view.history.length - 1];
      if (!rec) return ["The hand is finished."];
      const bidSide = rec.bidder % 2 === 0 ? "Your side" : "The other side";
      return [
        `${nm(rec.bidder)} bid ${rec.bid} in ${SUIT_WORD[rec.trump]}. Your side counted ${rec.meld.red} in meld and ${rec.tricks.red} in tricks; theirs counted ${rec.meld.blue} and ${rec.tricks.blue}. ${rec.wentSet ? `${bidSide} fell short of the bid and went set.` : `${bidSide} made it.`}`,
        `So you are ${signed(rec.delta.red)} and they are ${signed(rec.delta.blue)}. The scorepad breaks every line down: open it and match it against the cards on the table.`,
      ];
    }

    case "game_over":
      return [
        view.winner === "red" ? "Your side reached the target first. That is a win." : "The other side got there first. That is how it goes in pinochle.",
        "The scorepad has every hand. Start over to play again from the first deal.",
      ];
  }
}
