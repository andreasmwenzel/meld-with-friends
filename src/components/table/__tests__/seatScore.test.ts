import { describe, expect, it } from "vitest";
import type { MeldItem, SeatIndex } from "@/engine/types";
import { seatScore, type ScoreFacts } from "../SeatScore";

const run: MeldItem = { kind: "run", cards: ["JH0", "AH0", "QH0", "TH0", "KH0"], points: 15 };
const dix: MeldItem = { kind: "dix", cards: ["9H0"], points: 1 };
const dix2: MeldItem = { kind: "dix", cards: ["9H1"], points: 1 };
const names = ["You", "Mabel", "Otto", "Pearl"];
const nameOf = (s: SeatIndex) => names[s];

const facts = (over: Partial<ScoreFacts> = {}): ScoreFacts => ({
  phase: "playing", handNumber: 1, dealer: 2, bidder: 3, highBid: { seat: 3, amount: 35 }, trump: "H", bids: [],
  meldPoints: { 0: 0, 1: 0, 2: 0, 3: 17 }, melds: { 0: [], 1: [], 2: [], 3: [run, dix, dix2] },
  counters: { red: 0, blue: 4 }, history: [], ...over,
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

  it("gives a defender their side's pieces", () => {
    const marriage: MeldItem = { kind: "marriage", cards: ["KS0", "QS0"], points: 2 };
    const score = seatScore(facts({ meldPoints: { 0: 0, 1: 0, 2: 2, 3: 17 }, melds: { 0: [], 1: [], 2: [marriage], 3: [run] } }), 2, nameOf);
    expect(score.small).toBe(2);
    expect(score.smallSide).toBe(true);
    expect(score.top).toEqual([]);
    expect(score.meld).toEqual([{ name: "Otto", items: [marriage], points: 2 }]);
  });

  it("shows a defender their own meld while meld is laid down, then their side's running total", () => {
    const marriage: MeldItem = { kind: "marriage", cards: ["KS0", "QS0"], points: 2 };
    const over = { meldPoints: { 0: 0, 1: 0, 2: 2, 3: 17 } as Record<SeatIndex, number>, melds: { 0: [], 1: [], 2: [marriage], 3: [run] }, counters: { red: 10, blue: 4 } };
    expect(seatScore(facts({ ...over, phase: "melding" }), 0, nameOf, true).small).toBe(0);
    const playing = seatScore(facts(over), 0, nameOf);
    expect(playing.small).toBe(12);
    expect(playing.rows.at(-1)).toEqual(["So far", "12"]);
    expect(seatScore(facts(over), 2, nameOf).small).toBe(12);
  });
});
