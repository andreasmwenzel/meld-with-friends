import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export const METRIC_KEYS = [
  "act", "act_conflict", "tick", "tick_noop", "tick_fail", "broadcast_fail",
  "resync_view", "rate_limited", "cleanup_run", "cleanup_finished_tables",
  "cleanup_deleted_tables", "cleanup_pruned_guests", "push_sent", "push_fail",
] as const;
export type MetricKey = typeof METRIC_KEYS[number];
export type DailyMetrics = Record<MetricKey, number>;
export const emptyMetrics = (): DailyMetrics => Object.fromEntries(METRIC_KEYS.map(key => [key, 0])) as DailyMetrics;

let pending = new Map<MetricKey, number>();
let increments = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

function flush() {
  if (timer) clearTimeout(timer);
  timer = undefined;
  const batch = pending;
  pending = new Map();
  increments = 0;
  // Drop failed batches. Retries could double-count and telemetry must stay bounded.
  for (const [key, count] of batch) {
    void (async () => {
      try {
        await createAdminClient().rpc("bump_metric", { p_key: key, p_n: count });
      } catch { /* Best effort, including client construction and transport failures. */ }
    })();
  }
}

/** Approximate counters: never await telemetry in a request. */
export function bump(key: MetricKey, n = 1): void {
  try {
    if (!Number.isSafeInteger(n) || n <= 0) return;
    pending.set(key, (pending.get(key) ?? 0) + n);
    increments++;
    if (increments >= 50) flush();
    else if (!timer) {
      timer = setTimeout(flush, 5000);
      timer.unref?.();
    }
  } catch { /* Telemetry must not affect application behavior. */ }
}
