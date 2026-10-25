import "server-only";
import { bump } from "./metrics";
import { createAdminClient } from "@/lib/supabase/admin";
import { ApiError, checkDb } from "./errors";

export async function enforce(key: string, limit: number, windowSeconds: number) {
  const { data, error } = await createAdminClient().rpc("consume_rate", { p_key: key, p_limit: limit, p_window_seconds: windowSeconds });
  checkDb(error);
  if (!data) { bump("rate_limited"); throw new ApiError(429, `Slow down: limit of ${limit} requests per ${windowSeconds} seconds`); }
}
