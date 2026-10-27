import { describe, expect, it } from "vitest";
import { buildScenario } from "@/engine/scenario";
import { SITUATIONS, botVoices, neutralVoice, pickLine, pickTableTalk, talkDue, talkSituations, voiceFor, type TalkFacts, type TalkSituation, type Voice } from "@/lib/bots/tableTalk";

const hand = buildScenario({ to: "hand_over", seed: "table-talk", rules: { target: 9999 } }).state.history[0];
const facts = (): TalkFacts => ({ hand: { ...structuredClone(hand), bidder: 0, wentSet: false, meld: { red: 0, blue: 0 }, bid: 25 }, score: { red: 50, blue: 50 }, winner: null, minBid: 25, scale: 0.1 });
const seats = [{ seat: 0 as const, bot: true, name: "Mabel" }, { seat: 2 as const, bot: false, name: "Margaret" }];

describe("public bot table talk", () => {
  const voices = [...Object.entries(botVoices), ["neutral", neutralVoice]] as [string, Voice][];
  const forbidden = /\{|\}|[ATKQJ9][SHDC][01]|passed|your hand|holding|you held|you have|shuffle seed|\b(kitty|widow|bets?|betting|wager|money|cash|chips|jackpot|casino)\b|\$/i;
  // Placeholders a situation may use: the bidder is the speaker itself, or unknown, in the others.
  const bidderNamed = new Set<TalkSituation>(["partnerMade", "opponentMade", "opponentSmallMade", "opponentSet"]);
  const unnamed = new Set<TalkSituation>(["shootMade", "shootMissed", "bigMeld"]);

  it("has a voice for each of the six bots, keyed by their assigned names", () => {
    expect(Object.keys(botVoices).sort()).toEqual(["Gus", "Hazel", "Mabel", "Otto", "Pearl", "Walt"]);
  });
  it.each(voices)("%s has at least six distinct, reachable, short, safe lines for every situation", (name, voice) => {
    expect(Object.keys(voice).sort()).toEqual([...SITUATIONS].sort());
    for (const situation of SITUATIONS) {
      const choices = voice[situation];
      expect(new Set(choices).size, `${name} ${situation}`).toBe(choices.length);
      expect(choices.length, `${name} ${situation}`).toBeGreaterThanOrEqual(6);
      const seen = new Set<string>();
      for (let seed = 0; seed < 500; seed++) {
        const text = pickLine(situation, String(seed), { bidder: "Margaret", partner: "Alexandertheverylongname" }, name);
        seen.add(text);
        expect(text.length).toBeLessThan(80);
        expect(text, `${name} ${situation}`).not.toMatch(forbidden);
        expect(pickLine(situation, String(seed), { bidder: "Margaret", partner: "Alexandertheverylongname" }, name)).toBe(text);
      }
      expect(seen.size, `${name} ${situation}`).toBe(choices.length);
      for (const line of choices) {
        if (!bidderNamed.has(situation)) expect(line, `${name} ${situation}`).not.toContain("{bidder}");
        if (unnamed.has(situation)) expect(line, `${name} ${situation}`).not.toContain("{partner}");
        expect(line.replaceAll(/\{(bidder|partner)\}/g, ""), `${name} ${situation}`).not.toMatch(/[{}]/);
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
    const filled = (voice: Voice) => voice.rematch.map(line => line.replaceAll("{partner}", "June"));
    for (let i = 0; i < 50; i++) {
      expect(filled(botVoices.Walt)).toContain(pickLine("rematch", `${i}`, { bidder: "friend", partner: "June" }, "Walt"));
      for (const other of ["", "Ruth", "walt", "constructor", "__proto__", "toString"]) {
        expect(filled(neutralVoice)).toContain(pickLine("rematch", `${i}`, { bidder: "friend", partner: "June" }, other));
      }
      expect(filled(neutralVoice)).toContain(pickLine("rematch", `${i}`, { bidder: "friend", partner: "June" }));
    }
    expect(voiceFor("Otto")).toBe(botVoices.Otto);
    expect(voiceFor("Nobody")).toBe(neutralVoice);
  });
  it("substitutes public names wherever a line names someone, and bounds even long names", () => {
    const fill = (line: string) => line.replaceAll("{bidder}", "Margaret").replaceAll("{partner}", "June");
    for (const [name, voice] of voices) {
      for (const situation of SITUATIONS) {
        const expected = new Set(voice[situation].map(fill));
        for (let seed = 0; seed < 500; seed++) {
          const text = pickLine(situation, String(seed), { bidder: "Margaret", partner: "June" }, name);
          expect(expected.has(text), text).toBe(true);
          for (const longName of ["x".repeat(300), "😀".repeat(30), "Line\nbreak\tname"]) {
            const long = pickLine(situation, String(seed), { bidder: longName, partner: longName }, name);
            expect(long.length, long).toBeLessThan(80);
            expect(long).not.toMatch(/[\r\n\t]/);
          }
        }
      }
      // Lines about another player's bid mostly address that player by name.
      for (const situation of ["partnerMade", "opponentMade", "opponentSmallMade"] as const) {
        expect(voice[situation].filter(line => line.includes("{bidder}")).length, `${name} ${situation}`).toBeGreaterThanOrEqual(4);
      }
    }
  });
  it("picks the same line for the same seed, and varies across seeds", () => {
    const names = { bidder: "Margaret", partner: "June" };
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
