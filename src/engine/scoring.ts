import { DEFAULT_RULES, type RulesConfig } from './types';

export const POINT_RULE_KEYS = ['target', 'minBid', 'bidStep', 'lastTrickBonus', 'shootPoints', 'counterValue'] as const;

/** Classic point constants remain the source of truth throughout the engine. */
export function scoringFactor(rules: Pick<RulesConfig, 'scoring'>): number {
  return rules.scoring === 'modern' ? 0.1 : 1;
}

/**
 * Old full game states always used classic units. Partial preferences only imply
 * classic units when they contain points or the old-style counter scheme.
 */
export function resolveRules(patch: Partial<RulesConfig> | Record<string, unknown> | null | undefined, stored = false): RulesConfig {
  const input = (patch ?? {}) as Partial<RulesConfig>;
  const scoring = input.scoring ?? (stored || input.counting === 'classic'
    || POINT_RULE_KEYS.some(key => input[key] !== undefined) ? 'classic' : 'modern');
  const defaults = { ...DEFAULT_RULES, scoring };
  if (scoring === 'classic') {
    for (const key of POINT_RULE_KEYS) defaults[key] *= 10;
  }
  return { ...defaults, ...input, scoring };
}
