import { DEFAULT_RULES, type RulesConfig } from './types';

export const POINT_RULE_KEYS = ['target', 'minBid', 'bidStep', 'lastTrickBonus', 'counterValue'] as const;

/** Classic point constants remain the source of truth throughout the engine. */
export function scoringFactor(rules: Pick<RulesConfig, 'scoring'>): number {
  return rules.scoring === 'modern' ? 0.1 : 1;
}

/**
 * Old full game states always used classic units. Partial preferences only imply
 * classic units when they contain points or the old-style counter scheme.
 */
export function resolveRules(patch: Partial<RulesConfig> | Record<string, unknown> | null | undefined, stored = false): RulesConfig {
  const raw = patch ?? {};
  // Stored preferences and games used two enabled modes before solo shooting.
  const { shootPoints: _oldStake, ...rest } = raw as Record<string, unknown>;
  const input = { ...rest, ...('shoot' in rest ? { shoot: ['game', 'points'].includes(String(rest.shoot)) ? 'on' : rest.shoot } : {}) } as Partial<RulesConfig>;
  const scoring = input.scoring ?? (stored || input.counting === 'classic'
    || typeof _oldStake === 'number' || POINT_RULE_KEYS.some(key => input[key] !== undefined) ? 'classic' : 'modern');
  const defaults = { ...DEFAULT_RULES, scoring };
  if (scoring === 'classic') {
    for (const key of POINT_RULE_KEYS) defaults[key] *= 10;
  }
  return { ...defaults, ...input, scoring };
}

/** Original stake for archived four-player shoots. Never used for a newly declared shoot. */
export function legacyShootRules(rules: RulesConfig | Record<string, unknown>): NonNullable<import('./types').GameState['legacyShootRules']> {
  const raw = rules as Record<string, unknown>;
  const resolved = resolveRules(rules, true);
  return { mode: raw.shoot === 'points' ? 'points' : 'game',
    points: typeof raw.shootPoints === 'number' ? raw.shootPoints : resolved.scoring === 'classic' ? 1500 : 150 };
}
