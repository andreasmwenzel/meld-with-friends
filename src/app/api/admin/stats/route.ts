import { json } from "@/server/http";
import { requireAdmin } from "@/server/admin";
import { getUsageStats } from "@/server/settings";
export async function GET() {
  return json(async () => { await requireAdmin(); return getUsageStats(); });
}
