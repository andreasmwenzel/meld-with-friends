import { timingSafeEqual } from "node:crypto";
import { getServerEnv } from "@/lib/env";
import { ApiError } from "@/server/errors";
import { json } from "@/server/http";

/** Reports the Node.js version functions actually run on, for security advisories (#44). Read-only, CRON_SECRET only. */
export async function GET(request: Request) {
  return json(async () => {
    const expected = Buffer.from(`Bearer ${getServerEnv().CRON_SECRET}`);
    const actual = Buffer.from(request.headers.get("authorization") ?? "");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new ApiError(401, "Unauthorized");
    return { node: process.version, brotli: process.versions.brotli, region: process.env.VERCEL_REGION ?? null };
  });
}
