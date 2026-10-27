import { describe, expect, it } from "vitest";
import { buildScenario } from "@/engine/scenario";
import { lines, pickLine, pickTableTalk, talkDue, talkSituations, type TalkFacts, type TalkSituation } from "@/lib/bots/tableTalk";

const hand = buildScenario({ to: "hand_over", seed: "table-talk", rules: { target: 9999 } }).state.history[0];
const facts = (): TalkFacts => ({ hand: { ...structuredClone(hand), bidder: 0, wentSet: false, meld: { red: 0, blue: 0 }, bid: 25 }, score: { red: 50, blue: 50 }, winner: null, minBid: 25, scale: 0.1 });
const seats = [{ seat: 0 as const, bot: true, name: "Mabel" }, { seat: 2 as const, bot: false, name: "Margaret" }];

describe("public bot table talk", () => {
  it.each(Object.keys(lines) as TalkSituation[])("has eight varied, short, safe lines for %s", situation => {
    expect(new Set(lines[situation]).size).toBeGreaterThanOrEqual(8);
    const seen = new Set<string>();
    for (let seed = 0; seed < 500; seed++) {
      const text = pickLine(situation, String(seed), { bidder: "Margaret", partner: "Alexandertheverylongname" });
      seen.add(text);
      expect(text.length).toBeLessThan(80);
      expect(text).not.toMatch(/\{|\}|[ATKQJ9][SHDC][01]|passed|your hand|holding|you held|you have|shuffle seed/i);
      expect(pickLine(situation, String(seed), { bidder: "Margaret", partner: "Alexandertheverylongname" })).toBe(text);
    }
    expect(seen.size).toBe(8);
  });
  it("substitutes public names and bounds even long names", () => {
    const samples = Array.from({ length: 100 }, (_, i) => pickLine("partnerMade", String(i), { bidder: "Margaret", partner: "Gus" }));
    expect(samples.every(line => line.includes("Margaret"))).toBe(true);
    for (const situation of Object.keys(lines) as TalkSituation[]) {
      for (let i = 0; i < 100; i++) {
        for (const longName of ["x".repeat(300), "😀".repeat(30)]) {
          expect(pickLine(situation, `${i}`, { bidder: longName, partner: longName }).length).toBeLessThan(80);
        }
      }
    }
  });
  it("alternates three/four hand gaps at many tables, with a quiet opening", () => {
    for (let table = 0; table < 100; table++) {
      const id = `table-${table}`;
      const due = Array.from({ length: 1000 }, (_, i) => i + 1).filter(hand => talkDue(id, hand));
      expect(talkDue(id, 1)).toBe(false);
      expect(due.length / 1000).toBeGreaterThanOrEqual(0.25);
      expect(due.length / 1000).toBeLessThanOrEqual(1 / 3);
      for (let i = 1; i < due.length; i++) expect([3, 4]).toContain(due[i] - due[i - 1]);
    }
  });
  it.each([
    ["selfMade", (f: TalkFacts) => f, 0],
    ["partnerMade", (f: TalkFacts) => f, 2],
    ["ownSet", (f: TalkFacts) => { f.hand.wentSet = true; return f; }, 0],
    ["opponentSet", (f: TalkFacts) => { f.hand.wentSet = true; return f; }, 1],
    ["opponentMade", (f: TalkFacts) => { f.hand.bid = 50; return f; }, 1],
    ["opponentSmallMade", (f: TalkFacts) => f, 1],
    ["shootMade", (f: TalkFacts) => { f.hand.shotMade = true; return f; }, 0],
    ["shootMissed", (f: TalkFacts) => { f.hand.shotMade = false; return f; }, 0],
    ["bigMeld", (f: TalkFacts) => { f.hand.meld.blue = 40; return f; }, 0],
    ["leading", (f: TalkFacts) => { f.score.red = 130; return f; }, 0],
    ["trailing", (f: TalkFacts) => { f.score.blue = 130; return f; }, 0],
    ["win", (f: TalkFacts) => { f.winner = "red"; return f; }, 0],
    ["loss", (f: TalkFacts) => { f.winner = "blue"; return f; }, 0],
  ] as const)("recognizes %s from public results and the speaker's team", (situation, prepare, seat) => {
    expect(talkSituations(prepare(facts()), seat)).toContain(situation);
  });
  it("keeps classic/modern thresholds equivalent", () => {
    const modern = facts(); modern.hand.bid = 50; modern.hand.meld.blue = 40; modern.score.blue = 130;
    const classic = structuredClone(modern); classic.scale = 1; classic.minBid *= 10; classic.hand.bid *= 10;
    classic.hand.meld.blue *= 10; classic.score.red *= 10; classic.score.blue *= 10;
    expect(talkSituations(classic, 1)).toEqual(talkSituations(modern, 1));
  });
  it("picks exactly one bot, deterministically, for results and lifecycle events", () => {
    for (const event of [facts(), "redeal", "rematch"] as const) {
      const result = pickTableTalk(seats, "independent-seed", event);
      expect(result).toMatchObject({ seat: 0, name: "Mabel", text: expect.any(String) });
      expect(pickTableTalk([...seats].reverse(), "independent-seed", event)).toEqual(result);
      expect(pickTableTalk(seats.filter(s => !s.bot), "seed", event)).toBeNull();
    }
  });
});
