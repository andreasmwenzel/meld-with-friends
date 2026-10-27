import { describe, expect, it } from "vitest";
import { changeRule, changeScoring, describeRules, POINT_OPTIONS, resolveRules } from "../rules";

describe("scoring selection", () => {
  it("converts every point setting when switching the default rules to classic and back", () => {
    const modern = resolveRules({});
    const classic = changeScoring(modern, "classic");
    expect(classic).toMatchObject({ scoring: "classic", target: 1500, minBid: 250, bidStep: 10,
      lastTrickBonus: 10, counterValue: 10 });
    expect(changeScoring(classic, "modern")).toEqual(modern);
  });

  it("snaps the classic 25-point bid step to a supported integer modern option that keeps 25 biddable", () => {
    const modern = changeScoring({ scoring: "classic", bidStep: 25 }, "modern");
    expect(modern.bidStep).toBe(1);
    expect(Number.isInteger(modern.bidStep)).toBe(true);
  });

  it("snaps custom values to the nearest option, with ties choosing the lower option", () => {
    const modern = changeScoring({ scoring: "classic", target: 1750, minBid: 275,
      lastTrickBonus: 19 }, "modern");
    expect(modern).toMatchObject({ target: 150, minBid: 25, lastTrickBonus: 2 });
    for (const key of Object.keys(POINT_OPTIONS.modern) as (keyof typeof POINT_OPTIONS.modern)[]) {
      expect(POINT_OPTIONS.modern[key]).toContain(modern[key]);
    }
  });

  it("switches to classic scoring when old-style counting is selected", () => {
    expect(changeRule({}, "counting", "classic")).toMatchObject({ scoring: "classic", counting: "classic",
      target: 1500, minBid: 250, bidStep: 10, counterValue: 10 });
  });

  it("returns to tens counting when switching old-style counting to modern scoring", () => {
    expect(changeScoring({ scoring: "classic", counting: "classic" }, "modern"))
      .toMatchObject({ scoring: "modern", counting: "tens", counterValue: 1 });
  });

  it("keeps scoring explicit when changing a point setting from an empty patch", () => {
    expect(changeRule({}, "target", 200)).toMatchObject({ scoring: "modern", target: 200 });
  });
});

describe("rules summary", () => {
  it("describes modern default values", () => {
    expect(describeRules({})).toContain("Play to 150.");
    expect(describeRules({})).toContain("Minimum bid 25, in steps of 1.");
    expect(describeRules({})).toContain("Aces, tens and kings count 1 each, plus 1 for the last trick.");
  });

  it("describes classic values and old-style counting separately", () => {
    expect(describeRules({ scoring: "classic" })).toContain("Aces, tens and kings count 10 each, plus 10 for the last trick.");
    expect(describeRules({ scoring: "classic", counting: "classic" }))
      .toContain("Old-style count: aces 11, tens 10, kings 4, queens 3, jacks 2, plus 10 for the last trick.");
  });

  it("keeps the minimum bid reachable after converting, and leaves values alone when the scale stays", () => {
    const modern = changeScoring({ scoring: "classic", minBid: 250, bidStep: 25 }, "modern");
    expect(modern.minBid % modern.bidStep).toBe(0);
    expect(modern).toMatchObject({ minBid: 25, bidStep: 1 });
    const classic = changeScoring({ scoring: "modern", minBid: 25, bidStep: 2 }, "classic");
    expect(classic.minBid % classic.bidStep).toBe(0);
    expect(changeScoring({ scoring: "classic", target: 3000, minBid: 350 }, "classic")).toMatchObject({ target: 3000, minBid: 350 });
    expect(changeRule({ scoring: "classic", target: 3000 }, "counting", "classic")).toMatchObject({ target: 3000, counting: "classic" });
  });
});
