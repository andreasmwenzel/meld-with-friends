import { json, requireUser } from "@/server/http";
import { listHistory } from "@/server/history";
export async function GET() {
  return json(async () => { const { user } = await requireUser(); return listHistory(user.id); });
}
