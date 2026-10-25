import { describe, expect, it } from "vitest";
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

  it("accepts shoot actions with only the seat and type", () => {
    expect(actionSchema.parse({ type: "shoot", seat: 1 })).toEqual({ type: "shoot", seat: 1 });
    expect(actionSchema.safeParse({ type: "shoot", seat: 1, amount: 500 }).success).toBe(false);
  });
});
