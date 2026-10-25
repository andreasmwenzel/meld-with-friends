import { z } from "zod";

/**
 * Runtime settings an admin can change without a deploy. Stored as one jsonb row in
 * `app_settings` (key = 'global'); defaults here apply to anything missing.
 */
export const botConfigSchema = z.object({
  /** determinized Monte Carlo samples per trick decision */
  samples: z.number().int().min(1).max(400),
  /** wall-clock cap per decision, ms */
  budgetMs: z.number().int().min(1).max(500),
  /** points held back from the projected hand value when bidding */
  bidMargin: z.number().int().min(0).max(300),
  /** multiplier on projected trick points (1 = neutral, >1 bids more) */
  bidAggression: z.number().min(0.5).max(2),
  /** extra points a bot adds to its projection when its partner has bid */
  partnerBidBonus: z.number().int().min(0).max(300),
  /** minimum trump count before a bot will even consider shooting */
  shootMinTrump: z.number().int().min(5).max(12),
  /** lead trump to pull when holding at least this many */
  pullTrumpMin: z.number().int().min(3).max(12),
  /** 0 = never smear counters onto partner's tricks, 1 = always when safe */
  smearWillingness: z.number().min(0).max(1),
  /** delay before a bot's move is applied, ms (pacing, not thinking time) */
  tickDelayMs: z.number().int().min(0).max(5000),
});
export type BotConfig = z.infer<typeof botConfigSchema>;

export const limitsSchema = z.object({
  tablesPerHour: z.number().int().min(1).max(1000),
  actionsPerHour: z.number().int().min(10).max(100000),
  ticksPerTablePerHour: z.number().int().min(10).max(100000),
  friendRequestsPerHour: z.number().int().min(1).max(1000),
  profileEditsPerHour: z.number().int().min(1).max(1000),
  maxOpenTablesPerHost: z.number().int().min(1).max(50),
  /** finish tables with no activity for this many hours */
  idleTableHours: z.number().int().min(1).max(720),
  leisurelyIdleDays: z.number().int().min(1).max(365),
  /** delete finished tables, games and logs after this many days */
  retainFinishedDays: z.number().int().min(1).max(365),
  /** delete guest accounts that never sat down after this many days */
  retainGuestDays: z.number().int().min(1).max(365),
});
export type Limits = z.infer<typeof limitsSchema>;

export const settingsSchema = z.object({ bots: botConfigSchema, limits: limitsSchema });
export type Settings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  bots: {
    samples: 40, budgetMs: 40, bidMargin: 20, bidAggression: 1, partnerBidBonus: 20,
    shootMinTrump: 8, pullTrumpMin: 6, smearWillingness: 0.7, tickDelayMs: 900,
  },
  limits: {
    tablesPerHour: 10, actionsPerHour: 600, ticksPerTablePerHour: 2000, friendRequestsPerHour: 20,
    profileEditsPerHour: 30, maxOpenTablesPerHost: 3, idleTableHours: 48, leisurelyIdleDays: 60, retainFinishedDays: 30, retainGuestDays: 30,
  },
};

/** Partial, deep-merged patch schema used by the admin PATCH route. */
export const settingsPatchSchema = z.object({ bots: botConfigSchema.partial().strict().optional(), limits: limitsSchema.partial().strict().optional() }).strict();

export function mergeSettings(stored: unknown): Settings {
  const parsed = settingsPatchSchema.safeParse(stored ?? {});
  const p = parsed.success ? parsed.data : {};
  return { bots: { ...DEFAULT_SETTINGS.bots, ...(p.bots ?? {}) }, limits: { ...DEFAULT_SETTINGS.limits, ...(p.limits ?? {}) } };
}

/** Field metadata for the admin form. Kept next to the schema so labels never drift. */
export const SETTING_FIELDS: { group: "bots" | "limits"; key: string; label: string; help: string; step?: number }[] = [
  { group: "bots", key: "samples", label: "Monte Carlo samples", help: "Hidden-hand samples per trick decision. More is smarter and slower." },
  { group: "bots", key: "budgetMs", label: "Thinking budget (ms)", help: "Hard cap per decision. Keeps serverless compute cheap." },
  { group: "bots", key: "bidMargin", label: "Bid safety margin", help: "Points held back from the projected hand value." },
  { group: "bots", key: "bidAggression", label: "Bid aggression", help: "Multiplier on projected trick points. Above 1 bids more.", step: 0.05 },
  { group: "bots", key: "partnerBidBonus", label: "Partner bid bonus", help: "Added to the projection when the partner has bid." },
  { group: "bots", key: "shootMinTrump", label: "Shoot: minimum trump", help: "Never shoots the moon with fewer trump than this." },
  { group: "bots", key: "pullTrumpMin", label: "Pull trump from", help: "Leads trump to pull when holding at least this many." },
  { group: "bots", key: "smearWillingness", label: "Smear willingness", help: "0 never adds counters to partner's safe tricks, 1 always.", step: 0.05 },
  { group: "bots", key: "tickDelayMs", label: "Move pacing (ms)", help: "Pause before each bot move so people can follow the trick." },
  { group: "limits", key: "tablesPerHour", label: "Tables per user per hour", help: "Dealing budget." },
  { group: "limits", key: "actionsPerHour", label: "Game actions per user per hour", help: "Bids, plays, melds." },
  { group: "limits", key: "ticksPerTablePerHour", label: "Bot moves per table per hour", help: "Caps bot compute per table." },
  { group: "limits", key: "friendRequestsPerHour", label: "Friend requests per hour", help: "Per user." },
  { group: "limits", key: "profileEditsPerHour", label: "Profile edits per hour", help: "Per user." },
  { group: "limits", key: "maxOpenTablesPerHost", label: "Open tables per host", help: "Unfinished tables one person may host." },
  { group: "limits", key: "idleTableHours", label: "Idle table timeout (hours)", help: "Tables with no activity for this long are finished by the daily cron." },
  { group: "limits", key: "leisurelyIdleDays", label: "Leisurely idle timeout (days)", help: "Tables at a leisurely pace are finished after this long without a move." },
  { group: "limits", key: "retainFinishedDays", label: "Keep finished tables (days)", help: "Then games and logs are deleted." },
  { group: "limits", key: "retainGuestDays", label: "Keep unused guests (days)", help: "Guest accounts that never sat down are removed after this." },
];
