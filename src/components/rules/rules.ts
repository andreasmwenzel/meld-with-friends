import { DEFAULT_RULES, type RulesConfig } from "@/engine/types";

export type RulesPatch = Partial<RulesConfig>;

/** The rules a table will actually play with: defaults overlaid with the host's choices. */
export function resolveRules(patch: RulesPatch | Record<string, unknown> | undefined): RulesConfig {
  return { ...DEFAULT_RULES, ...(patch as RulesPatch) };
}

/** Plain-language summary for the seating screen and lobby. */
export function describeRules(patch: RulesPatch | Record<string, unknown> | undefined): string[] {
  const r = resolveRules(patch);
  const lines = [
    `Play to ${r.target.toLocaleString()}.`,
    `Minimum bid ${r.minBid}, in steps of ${r.bidStep}.`,
    r.passCount ? `Pass ${r.passCount} cards each way.` : "No passing.",
    r.counting === "classic"
      ? `Classic count: aces 11, tens 10, kings 4, queens 3, jacks 2, plus ${r.lastTrickBonus} for the last trick.`
      : `Aces, tens and kings count 10 each, plus ${r.lastTrickBonus} for the last trick.`,
    r.mustTakeTrickToSaveMeld ? "Take a trick to keep your meld." : "Meld counts even without a trick.",
    r.dealerStuck ? `If everyone passes, the dealer is stuck at ${r.minBid}.` : "If everyone passes, redeal.",
  ];
  lines.push(r.revealHands ? "Everyone's cards are shown after each hand." : "Hands stay hidden after each hand.");
  if (r.shoot === "game") lines.push("Shooting the moon wins or loses the game.");
  if (r.shoot === "points") lines.push(`Shooting the moon is worth ${r.shootPoints.toLocaleString()} points, made or set.`);
  if (r.pace === "leisurely") lines.push("Leisurely pace: the table waits for you for weeks.");
  return lines;
}
