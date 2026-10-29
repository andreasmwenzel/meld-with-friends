import { type RulesConfig } from "@/engine/types";

export type RulesPatch = Partial<RulesConfig>;

export { resolveRules } from "@/engine/scoring";
import { resolveRules } from "@/engine/scoring";

type PointField = "target" | "minBid" | "bidStep" | "lastTrickBonus";

/** Available point values in each scoring scale, shared by the form and conversion. */
export const POINT_OPTIONS: Record<RulesConfig["scoring"], Record<PointField, number[]>> = {
  modern: {
    target: [100, 150, 200, 250],
    minBid: [20, 25, 30],
    bidStep: [1, 2, 5],
    lastTrickBonus: [0, 1, 2],
  },
  classic: {
    target: [1000, 1500, 2000, 2500],
    minBid: [200, 250, 300],
    bidStep: [10, 20, 25, 50],
    lastTrickBonus: [0, 10, 20],
  },
};

/** Convert a form's current settings, snapping unsupported values to the nearest option. */
export function changeScoring(patch: RulesPatch, scoring: RulesConfig["scoring"]): RulesConfig {
  const current = resolveRules(patch);
  // Same scale: nothing to convert, so leave values the menus don't list untouched.
  if (current.scoring === scoring) return { ...current };
  const next = { ...current, scoring };
  const factor = scoring === "modern" ? 0.1 : 10;
  for (const key of Object.keys(POINT_OPTIONS[scoring]) as PointField[]) {
    const converted = current[key] * factor;
    next[key] = POINT_OPTIONS[scoring][key].reduce((nearest, option) =>
      Math.abs(option - converted) < Math.abs(nearest - converted) ? option : nearest);
  }
  // A step that doesn't divide the minimum makes the minimum unbiddable (25 in steps of 2 opens at 26):
  // use the listed step nearest the converted one that does divide it.
  if (next.minBid % next.bidStep !== 0) {
    const wanted = current.bidStep * factor;
    next.bidStep = POINT_OPTIONS[scoring].bidStep.filter((step) => next.minBid % step === 0)
      .sort((a, b) => Math.abs(a - wanted) - Math.abs(b - wanted))[0] ?? 1;
  }
  next.counterValue = scoring === "modern" ? 1 : 10;
  if (scoring === "modern") next.counting = "tens";
  return next;
}

/** Keep dependent settings valid when a select changes. */
export function changeRule(patch: RulesPatch, key: keyof RulesConfig, value: RulesConfig[keyof RulesConfig]): RulesPatch {
  if (key === "scoring") return changeScoring(patch, value as RulesConfig["scoring"]);
  const current = key === "counting" && value === "classic"
    ? changeScoring(patch, "classic")
    : resolveRules(patch);
  return { ...current, [key]: value };
}
