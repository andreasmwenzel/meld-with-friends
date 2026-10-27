import { describe, expect, it } from "vitest";
import { buildScenario } from "@/engine/scenario";
import { SITUATIONS, botVoices, neutralVoice, pickLine, pickTableTalk, talkDue, talkSituations, voiceFor, type TalkFacts, type TalkSituation, type Voice } from "@/lib/bots/tableTalk";

const hand = buildScenario({ to: "hand_over", seed: "table-talk", rules: { target: 9999 } }).state.history[0];
const facts = (): TalkFacts => ({ hand: { ...structuredClone(hand), bidder: 0, wentSet: false, meld: { red: 0, blue: 0 }, bid: 25 }, score: { red: 50, blue: 50 }, winner: null, minBid: 25, scale: 0.1 });
const seats = [{ seat: 0 as const, bot: true, name: "Mabel" }, { seat: 2 as const, bot: false, name: "Margaret" }];

describe("public bot table talk", () => {
  const voices = [...Object.entries(botVoices), ["neutral", neutralVoice]] as [string, Voice][];
  const forbidden = /\{|\}|[ATKQJ9][SHDC][01]|passed|your hand|holding|you held|you have|shuffle seed|\b(kitty|widow|bets?|betting|wager|money|cash|chips|jackpot|casino)\b|\$/i;
  // The picker cannot know a margin, so lines never say how close a set or a shoot was.
  const margin = /so close|close, though|room to spare|by a hair|one trick short|nearly/i;
  // {bidder} is another player only in these; elsewhere it is the speaker itself, or unknown.
  const bidderNamed = new Set<TalkSituation>(["partnerMade", "partnerSet", "opponentMade", "opponentSmallMade", "opponentSet",
    "partnerShootMade", "partnerShootMissed", "opponentShootMade", "opponentShootMissed"]);
  const shoots = SITUATIONS.filter(situation => situation.includes("Shoot"));
  const names = { bidder: "Margaret", partner: "June" };
  const fill = (line: string) => line.replaceAll("{bidder}", names.bidder).replaceAll("{partner}", names.partner);

  it("has a voice for each of the six bots, keyed by their assigned names", () => {
    expect(Object.keys(botVoices).sort()).toEqual(["Gus", "Hazel", "Mabel", "Otto", "Pearl", "Walt"]);
  });
  it.each(voices)("%s has at least six distinct, reachable, short, safe lines for every situation", (name, voice) => {
    expect(Object.keys(voice).sort()).toEqual([...SITUATIONS].sort());
    for (const situation of SITUATIONS) {
      const choices = voice[situation];
      const label = `${name} ${situation}`;
      expect(choices.length, label).toBeGreaterThanOrEqual(6);
      expect(new Set(choices).size, label).toBe(choices.length);
      const expected = new Set(choices.map(fill));
      const seen = new Set<string>();
      for (let seed = 0; seed < 200; seed++) {
        const text = pickLine(situation, String(seed), names, name);
        expect(expected.has(text), text).toBe(true);
        expect(pickLine(situation, String(seed), names, name)).toBe(text);
        seen.add(text);
      }
      expect(seen.size, label).toBe(choices.length);
      for (const line of choices) {
        // Worst case: every placeholder filled with a full 16-character name.
        expect(line.replaceAll(/\{(bidder|partner)\}/g, "x".repeat(16)).length, line).toBeLessThan(80);
        expect(fill(line), line).not.toMatch(forbidden);
        expect(line, line).not.toMatch(margin);
        if (!bidderNamed.has(situation)) expect(line, label).not.toContain("{bidder}");
        if (situation === "bigMeld") expect(line, label).not.toContain("{partner}");
      }
    }
  });
  it("addresses the other player by name in most lines about their bid or shoot", () => {
    for (const [name, voice] of voices) {
      for (const situation of ["partnerMade", "partnerSet", "opponentMade", "opponentSmallMade", ...shoots.filter(s => !s.startsWith("self"))] as TalkSituation[]) {
        expect(voice[situation].filter(line => line.includes("{bidder}")).length, `${name} ${situation}`).toBeGreaterThanOrEqual(4);
      }
    }
  });
  it("treats every shoot as game over and promises no next hand", () => {
    for (const [name, voice] of voices) {
      for (const situation of shoots) {
        for (const line of voice[situation]) expect(line, `${name} ${situation}`).not.toMatch(/next (time|hand|one)|tomorrow|another go/i);
        expect(voice[situation].filter(line => /good game|well played|congrat|game/i.test(line)).length, `${name} ${situation}`).toBeGreaterThanOrEqual(3);
      }
    }
  });
  it("gives each bot its own words, distinct from the others and from the fallback", () => {
    const owner = new Map<string, string>();
    for (const [name, voice] of voices) {
      for (const line of SITUATIONS.flatMap(situation => voice[situation])) {
        expect(owner.get(line), line).toBeUndefined();
        owner.set(line, name);
      }
    }
  });
  it("uses the speaker's voice, and the neutral voice for unknown or tricky names", () => {
    const filled = (voice: Voice) => voice.rematch.map(fill);
    for (let i = 0; i < 20; i++) {
      expect(filled(botVoices.Walt)).toContain(pickLine("rematch", `${i}`, names, "Walt"));
      for (const other of ["", "Ruth", "walt", "constructor", "__proto__", "toString"]) {
        expect(filled(neutralVoice)).toContain(pickLine("rematch", `${i}`, names, other));
      }
      expect(filled(neutralVoice)).toContain(pickLine("rematch", `${i}`, names));
    }
    expect(voiceFor("Otto")).toBe(botVoices.Otto);
    expect(voiceFor("Nobody")).toBe(neutralVoice);
  });
  it("substitutes names literally, preferring a first name over a mid-word cut", () => {
    // A seed whose Gus partnerMade line names the bidder, so the substitution is observable.
    const seed = Array.from({ length: 50 }, (_, i) => `${i}`).find(i => pickLine("partnerMade", i, names, "Gus").includes("Margaret"))!;
    const named = (bidder: string) => pickLine("partnerMade", seed, { bidder, partner: "June" }, "Gus");
    expect(named("Pat $& $$ $1 $'")).toContain("Pat $& $$ $1 $'");
    expect(named("Margaret Thompson")).not.toContain("Thompso");
    expect(named("Margaret Thompson")).toContain("Margaret");
    expect(named("Jo Park")).toContain("Jo Park");
    expect(named("Bartholomewthethird")).toContain("Bartholomewthet");
    expect(named("Line\nbreak\tname")).not.toMatch(/[\r\n\t]/);
    for (const longName of ["x".repeat(300), "😀".repeat(30), "a ".repeat(100)]) {
      for (const situation of SITUATIONS) {
        expect(pickLine(situation, seed, { bidder: longName, partner: longName }, "Gus").length).toBeLessThan(80);
      }
    }
  });
  it("picks the same line for the same seed, and varies across seeds", () => {
    for (const name of Object.keys(botVoices)) {
      const first = Array.from({ length: 20 }, (_, i) => pickLine("win", `game:${i}`, names, name));
      expect(Array.from({ length: 20 }, (_, i) => pickLine("win", `game:${i}`, names, name))).toEqual(first);
      expect(new Set(first).size).toBeGreaterThan(1);
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
    ["selfSet", (f: TalkFacts) => { f.hand.wentSet = true; return f; }, 0],
    ["partnerSet", (f: TalkFacts) => { f.hand.wentSet = true; return f; }, 2],
    ["opponentSet", (f: TalkFacts) => { f.hand.wentSet = true; return f; }, 1],
    ["opponentMade", (f: TalkFacts) => { f.hand.bid = 50; return f; }, 1],
    ["opponentSmallMade", (f: TalkFacts) => f, 1],
    ["selfShootMade", (f: TalkFacts) => { f.hand.shotMade = true; f.winner = "red"; return f; }, 0],
    ["selfShootMissed", (f: TalkFacts) => { f.hand.shotMade = false; f.winner = "blue"; return f; }, 0],
    ["partnerShootMade", (f: TalkFacts) => { f.hand.shotMade = true; f.winner = "red"; return f; }, 2],
    ["partnerShootMissed", (f: TalkFacts) => { f.hand.shotMade = false; f.winner = "blue"; return f; }, 2],
    ["opponentShootMade", (f: TalkFacts) => { f.hand.shotMade = true; f.winner = "red"; return f; }, 1],
    ["opponentShootMissed", (f: TalkFacts) => { f.hand.shotMade = false; f.winner = "blue"; return f; }, 3],
    ["bigMeld", (f: TalkFacts) => { f.hand.meld.blue = 40; return f; }, 0],
    ["leading", (f: TalkFacts) => { f.score.red = 130; return f; }, 0],
    ["trailing", (f: TalkFacts) => { f.score.blue = 130; return f; }, 0],
    ["win", (f: TalkFacts) => { f.winner = "red"; return f; }, 0],
    ["loss", (f: TalkFacts) => { f.winner = "blue"; return f; }, 0],
  ] as const)("recognizes %s from public results and the speaker's team", (situation, prepare, seat) => {
    const found = talkSituations(prepare(facts()), seat);
    // A shoot ends the game; its line stands in for the win/loss comment.
    if (situation.includes("Shoot")) expect(found).toEqual([situation]);
    else expect(found).toContain(situation);
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
  it("speaks in the chosen bot's own voice, or the neutral one for an unknown bot name", () => {
    const fill = (voice: Voice, situation: TalkSituation) => voice[situation].map(line => line.replaceAll("{bidder}", "Mabel").replaceAll("{partner}", "Margaret"));
    for (let i = 0; i < 30; i++) {
      const event = (["redeal", "rematch"] as const)[i % 2];
      expect(fill(botVoices.Mabel, event)).toContain(pickTableTalk(seats, `seed-${i}`, event)!.text);
      const result = pickTableTalk(seats, `seed-${i}`, facts())!;
      expect(fill(botVoices.Mabel, "selfMade")).toContain(result.text);
      const stranger = pickTableTalk([{ ...seats[0], name: "Ruth" }, seats[1]], `seed-${i}`, event)!;
      expect(stranger.name).toBe("Ruth");
      expect(fill(neutralVoice, event).map(line => line.replaceAll("Mabel", "Ruth"))).toContain(stranger.text);
    }
  });
});
