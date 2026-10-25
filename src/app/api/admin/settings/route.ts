import { body, json } from "@/server/http";
import { requireAdmin } from "@/server/admin";
import { getSettings, updateSettings } from "@/server/settings";
import { settingsPatchSchema } from "@/lib/settings";
export async function GET() {
  return json(async () => { await requireAdmin(); return getSettings(); });
}
export async function PATCH(request: Request) {
  return json(async () => { await requireAdmin(); return updateSettings(await body(request, settingsPatchSchema)); });
}
