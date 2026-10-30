import { describe, expect, it } from "vitest";
import type { HandRecord, HandScoreBreakdown, MeldItem, SeatIndex } from "@/engine/types";
import { seatScore, type ScoreFacts } from "../SeatScore";

const run: MeldItem = { kind: "run", cards: ["JH0", "AH0", "QH0", "TH0", "KH0"], points: 15 };
const dix: MeldItem = { kind: "dix", cards: ["9H0"], points: 1 };
const dix2: MeldItem = { kind: "dix", cards: ["9H1"], points: 1 };
const names = ["You", "Mabel", "Otto", "Pearl"];
const nameOf = (s: SeatIndex) => names[s];

const facts = (over: Partial<ScoreFacts> = {}): ScoreFacts => ({
  phase: "playing", handNumber: 1, dealer: 2, bidder: 3, highBid: { seat: 3, amount: 35 }, trump: "H", bids: [],
  meldPoints: { 0: 0, 1: 0, 2: 0, 3: 17 }, melds: { 0: [], 1: [], 2: [], 3: [run, dix, dix2] },
  counters: { red: 0, blue: 4 }, tricks: [], history: [], ...over,
});

describe("seatScore", () => {
  it("gives the taker the bid, then each melder's pieces, then counters and the running total", () => {
    const score = seatScore(facts(), 3, nameOf);
    expect(score.top).toEqual([["Bid", "35"]]);
    expect(score.meld).toEqual([{ name: "Pearl", items: [run, dix, dix2], points: 17 }]);
    expect(score.rows).toEqual([["Counters", "4"], ["So far", "21"]]);
  });

  it("leaves out a partner with no meld, except while meld lies on the table", () => {
    expect(seatScore(facts(), 3, nameOf).meld.map(m => m.name)).toEqual(["Pearl"]);
    expect(seatScore(facts({ phase: "melding" }), 3, nameOf, true).meld.map(m => m.name)).toEqual(["Mabel", "Pearl"]);
  });

  it("gives a defender only their own pieces", () => {
    const marriage: MeldItem = { kind: "marriage", cards: ["KS0", "QS0"], points: 2 };
    const score = seatScore(facts({ meldPoints: { 0: 3, 1: 0, 2: 2, 3: 17 }, melds: { 0: [], 1: [], 2: [marriage], 3: [run] } }), 2, nameOf);
    expect(score.top).toEqual([]);
    expect(score.meld).toEqual([{ name: "Otto", items: [marriage], points: 2 }]);
  });

  it("scores a defender alone: their own meld while melding, then meld plus the counters in tricks they won", () => {
    const over = { meldPoints: { 0: 0, 1: 0, 2: 1, 3: 17 } as Record<SeatIndex, number>, counters: { red: 13, blue: 4 },
      tricks: [{ winner: 2 as SeatIndex, counters: 10 }, { winner: 3 as SeatIndex, counters: 4 }, { winner: 0 as SeatIndex, counters: 3 }] };
    expect(seatScore(facts({ ...over, phase: "melding" }), 2, nameOf, true).small).toBe(1);
    const otto = seatScore(facts(over), 2, nameOf);
    expect(otto.small).toBe(11);
    expect(otto.rows).toEqual([["Counters", "10"], ["So far", "11"]]);
    expect(seatScore(facts(over), 0, nameOf).small).toBe(3);
  });

  it("keeps a defender's own total once the hand is scored; meld lost with no trick counts nothing", () => {
    const b = (over: Partial<HandScoreBreakdown>) => ({ meldDeclared: 0, meldSaved: 0, counters: 0, lastTrick: 0, setPenalty: 0, shoot: 0, ...over }) as HandScoreBreakdown;
    const record = (red: HandScoreBreakdown) => ({ handNumber: 1, dealer: 2, bidder: 3, bid: 35, trump: "H", meld: { red: 2, blue: 17 }, tricks: { red: 1, blue: 11 }, delta: { red: 0, blue: 39 },
      breakdown: { red, blue: b({ meldDeclared: 17, meldSaved: 17, counters: 22 }) }, wentSet: false }) as HandRecord;
    const at = { phase: "hand_over" as const, meldPoints: { 0: 0, 1: 0, 2: 2, 3: 17 } as Record<SeatIndex, number>, tricks: [{ winner: 2 as SeatIndex, counters: 3 }] };
    expect(seatScore(facts({ ...at, history: [record(b({ meldDeclared: 2, meldSaved: 2, counters: 3 }))] }), 2, nameOf).rows).toEqual([["Counters", "3"], ["Total", "5"]]);
    const lost = seatScore(facts({ ...at, tricks: [], history: [record(b({ meldDeclared: 2 }))] }), 2, nameOf);
    expect(lost.small).toBe(0);
    expect(lost.rows).toEqual([["Counters", "0"], ["Meld lost, no trick", "-2"], ["Total", "0"]]);
  });
});
