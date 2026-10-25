import { bump } from "@/server/metrics";
import { timingSafeEqual } from "node:crypto";
import { getServerEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { ApiError, checkDb } from "@/server/errors";
import { getSettings } from "@/server/settings";
import { json } from "@/server/http";

export async function GET(request: Request) {
  return json(async () => {
    const expected = Buffer.from(`Bearer ${getServerEnv().CRON_SECRET}`);
    const actual = Buffer.from(request.headers.get("authorization") ?? "");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new ApiError(401, "Unauthorized");
    bump("cleanup_run");
    const { limits } = await getSettings();
    const db = createAdminClient();
    const cleanup = await db.rpc("cleanup_tables", { p_idle_hours: limits.idleTableHours, p_leisurely_days: limits.leisurelyIdleDays, p_retain_days: limits.retainFinishedDays });
    checkDb(cleanup.error);
    const guests = await db.rpc("prune_guests", { p_days: limits.retainGuestDays });
    checkDb(guests.error);
    const summary: Record<string, number> = { ...cleanup.data, guestsDeleted: Number(guests.data) };
    bump("cleanup_finished_tables", summary.tablesFinished);
    bump("cleanup_deleted_tables", summary.tablesDeleted);
    bump("cleanup_pruned_guests", summary.guestsDeleted);
    const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const pruned = await db.from("metrics").delete().lt("day", cutoff);
    checkDb(pruned.error);
    const saved = await db.from("app_settings").upsert({ key: "last_cleanup", value: { at: new Date().toISOString(), summary } });
    checkDb(saved.error);
    return { ok: true, ...summary };
  });
}
