import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { mergeSettings, settingsPatchSchema, type Settings } from "@/lib/settings";
import type { UsageStats as ExistingUsageStats } from "@/components/admin/Usage";
import { checkDb } from "./errors";

import { emptyMetrics, METRIC_KEYS, type DailyMetrics } from "./metrics";

export interface UsageStats extends ExistingUsageStats {
  today: DailyMetrics;
  yesterday: DailyMetrics;
  lastCleanup: { at: string; summary: Record<string, number> } | null;
}

let cached: { value: Settings; expires: number } | undefined;
export async function getSettings(): Promise<Settings> {
  if (cached && cached.expires > Date.now()) return structuredClone(cached.value);
  const { data, error } = await createAdminClient().from("app_settings").select("value").eq("key", "global").maybeSingle();
  checkDb(error);
  const value = mergeSettings(data?.value);
  cached = { value, expires: Date.now() + 30_000 };
  return structuredClone(value);
}
export async function updateSettings(patch: unknown): Promise<Settings> {
  const parsed = settingsPatchSchema.parse(patch);
  // Merge under a row lock so concurrent patches to different fields both survive.
  const { data, error } = await createAdminClient().rpc("patch_settings", { p_patch: parsed });
  checkDb(error);
  cached = undefined;
  return mergeSettings(data);
}
export async function getUsageStats(): Promise<UsageStats> {
  const db = createAdminClient();
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const since = today.toISOString();
  const results = await Promise.all([
    db.from("tables").select("id", { count: "exact", head: true }).gte("created_at", since),
    db.from("game_actions").select("id", { count: "exact", head: true }).gte("created_at", since),
    db.from("game_actions").select("id", { count: "exact", head: true }).gte("created_at", since).eq("by_bot", true),
    db.from("tables").select("id", { count: "exact", head: true }).eq("status", "open"),
    db.from("tables").select("id", { count: "exact", head: true }).eq("status", "playing"),
    db.from("profiles").select("id", { count: "exact", head: true }),
    db.from("games").select("id", { count: "exact", head: true }),
    db.from("game_actions").select("id", { count: "exact", head: true }),
  ]);
  for (const result of results) checkDb(result.error);
  const guests = await db.rpc("count_guests"); checkDb(guests.error);
  const [tablesToday, actionsToday, ticksToday, openTables, playingTables, profiles, gamesStored, actionsStored] = results.map(r => r.count ?? 0);
  const yesterdayDate = new Date(today.getTime() - 86_400_000).toISOString().slice(0, 10);
  const [metrics, cleanup] = await Promise.all([
    db.from("metrics").select("day,key,count").gte("day", yesterdayDate).lte("day", since.slice(0, 10)),
    db.from("app_settings").select("value").eq("key", "last_cleanup").maybeSingle(),
  ]);
  checkDb(metrics.error); checkDb(cleanup.error);
  const daily = { today: emptyMetrics(), yesterday: emptyMetrics() };
  for (const row of metrics.data ?? []) {
    if (!METRIC_KEYS.includes(row.key)) continue;
    const bucket = row.day === since.slice(0, 10) ? daily.today : daily.yesterday;
    bucket[row.key as keyof DailyMetrics] = Number(row.count);
  }
  return { ...daily, lastCleanup: cleanup.data?.value ?? null, tablesToday, actionsToday, ticksToday, openTables, playingTables, profiles, guests: Number(guests.data), gamesStored, actionsStored };
}
