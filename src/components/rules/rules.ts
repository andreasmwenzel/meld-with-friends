import { type RulesConfig } from "@/engine/types";

export type RulesPatch = Partial<RulesConfig>;

export { resolveRules } from "@/engine/scoring";
import { resolveRules } from "@/engine/scoring";

type PointField = "target" | "minBid" | "bidStep" | "lastTrickBonus" | "shootPoints";

/** Available point values in each scoring scale, shared by the form and conversion. */
export const POINT_OPTIONS: Record<RulesConfig["scoring"], Record<PointField, number[]>> = {
  modern: {
    target: [100, 150, 200, 250],
    minBid: [20, 25, 30],
    bidStep: [1, 2, 5],
    lastTrickBonus: [0, 1, 2],
    shootPoints: [50, 100, 150, 200],
  },
  classic: {
    target: [1000, 1500, 2000, 2500],
    minBid: [200, 250, 300],
    bidStep: [10, 20, 25, 50],
    lastTrickBonus: [0, 10, 20],
    shootPoints: [500, 1000, 1500, 2000],
  },
};

/** Convert a form's current settings, snapping unsupported values to the nearest option. */
export function changeScoring(patch: RulesPatch, scoring: RulesConfig["scoring"]): RulesConfig {
  const current = resolveRules(patch);
  const next = { ...current, scoring };
  const factor = current.scoring === scoring ? 1 : scoring === "modern" ? 0.1 : 10;
  for (const key of Object.keys(POINT_OPTIONS[scoring]) as PointField[]) {
    const converted = current[key] * factor;
    next[key] = POINT_OPTIONS[scoring][key].reduce((nearest, option) =>
      Math.abs(option - converted) < Math.abs(nearest - converted) ? option : nearest);
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

/** Plain-language summary for the seating screen and lobby. */
export function describeRules(patch: RulesPatch | Record<string, unknown> | undefined): string[] {
  const r = resolveRules(patch);
  const lines = [
    `Play to ${r.target.toLocaleString()}.`,
    `Minimum bid ${r.minBid}, in steps of ${r.bidStep}.`,
    r.passCount ? `Pass ${r.passCount} cards each way.` : "No passing.",
    r.counting === "classic"
      ? `Old-style count: aces 11, tens 10, kings 4, queens 3, jacks 2, plus ${r.lastTrickBonus} for the last trick.`
      : `Aces, tens and kings count ${r.counterValue} each, plus ${r.lastTrickBonus} for the last trick.`,
    r.mustTakeTrickToSaveMeld ? "Take a trick to keep your meld." : "Meld counts even without a trick.",
    r.dealerStuck ? `If everyone passes, the dealer is stuck at ${r.minBid}.` : "If everyone passes, redeal.",
  ];
  lines.push(r.revealHands ? "Everyone's cards are shown after each hand." : "Hands stay hidden after each hand.");
  if (r.shoot === "game") lines.push("Shooting the moon wins or loses the game.");
  if (r.shoot === "points") lines.push(`Shooting the moon is worth ${r.shootPoints.toLocaleString()} points, made or set.`);
  if (r.pace === "leisurely") lines.push("Leisurely pace: the table waits for you for weeks.");
  return lines;
}
