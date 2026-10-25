import { json, type CodeContext } from "@/server/http";
import { requireAdmin } from "@/server/admin";
import { forceFinish } from "@/server/adminTables";
export async function POST(_request: Request, { params }: CodeContext) {
  return json(async () => { await requireAdmin(); return forceFinish((await params).code); });
}
