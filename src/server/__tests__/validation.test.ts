import { describe, expect, it } from "vitest";
import { POINT_OPTIONS, changeScoring } from "@/components/rules/rules";
import { DEFAULT_RULES } from "@/engine/types";
import { actionSchema, rulesSchema } from "@/server/validation";

describe("table rules validation", () => {
  it("accepts empty partials, every default, and supported boundary values", () => {
    for (const rules of [{}, DEFAULT_RULES,
      { target: 300, minBid: 100, bidStep: 20, passCount: 0, lastTrickBonus: 0, counting: "classic", dealerStuck: false, mustTakeTrickToSaveMeld: false },
      { target: 5000, minBid: 1000, bidStep: 25, passCount: 5, lastTrickBonus: 50 },
      { bidStep: 50, shoot: "game", shootPoints: 100 },
      { shoot: "points", shootPoints: 5000 },
      { revealHands: true }, { revealHands: false },
    ]) expect(rulesSchema.parse(rules)).toEqual(rules);
  });

  it.each([
    { target: 290 }, { target: 5010 }, { target: 505 },
    { minBid: 90 }, { minBid: 1010 }, { minBid: 105 },
    { bidStep: 30 }, { passCount: -1 }, { passCount: 6 }, { passCount: 1.5 },
    { lastTrickBonus: -1 }, { lastTrickBonus: 51 }, { lastTrickBonus: 0.5 },
    { counterValue: 2 }, { counting: "invalid" }, { counting: null },
    { mustTakeTrickToSaveMeld: 0 }, { dealerStuck: "false" },
    { revealHands: "true" }, { revealHands: null },
    { setPenaltyIsBid: false }, { unexpected: true },
    { shoot: "invalid" }, { shootPoints: 90 }, { shootPoints: 5010 }, { shootPoints: 105 },
  ])("rejects unsupported rules %j", rules => {
    expect(rulesSchema.safeParse(rules).success).toBe(false);
  });

  it("accepts every form point option in its scale", () => {
    for (const scoring of ["modern", "classic"] as const) {
      for (const [key, values] of Object.entries(POINT_OPTIONS[scoring])) {
        for (const value of values) expect(rulesSchema.safeParse({ scoring, [key]: value }).success).toBe(true);
      }
      expect(rulesSchema.safeParse(changeScoring({}, scoring)).success).toBe(true);
    }
  });

  it.each([
    { scoring: "modern", counting: "classic" },
    { scoring: "modern", target: 29 }, { scoring: "modern", target: 501 },
    { scoring: "modern", minBid: 9 }, { scoring: "modern", minBid: 101 },
    { scoring: "modern", shootPoints: 9 }, { scoring: "modern", shootPoints: 501 },
    { scoring: "modern", counterValue: 10 }, { scoring: "modern", bidStep: 10 },
    { scoring: "modern", lastTrickBonus: 6 },
    { scoring: "classic", counterValue: 1 }, { scoring: "classic", bidStep: 1 },
    { scoring: "future" }, { minBid: 25 }, { counterValue: 1 },
  ])("rejects mixed scales or invalid modern bounds %j", rules => {
    expect(rulesSchema.safeParse(rules).success).toBe(false);
  });

  it("accepts shoot actions with only the seat and type", () => {
    expect(actionSchema.parse({ type: "shoot", seat: 1 })).toEqual({ type: "shoot", seat: 1 });
    expect(actionSchema.safeParse({ type: "shoot", seat: 1, amount: 500 }).success).toBe(false);
  });
});
