import { z } from "zod";
import { json } from "@/server/http";
import { requireAdmin } from "@/server/admin";
import { listTables } from "@/server/adminTables";
const querySchema = z.object({
  status: z.enum(["open", "playing", "finished"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export async function GET(request: Request) {
  return json(async () => {
    await requireAdmin();
    const params = new URL(request.url).searchParams;
    return listTables(querySchema.parse({ status: params.get("status") ?? undefined, limit: params.get("limit") ?? undefined }));
  });
}
