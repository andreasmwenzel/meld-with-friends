import { z } from "zod";
import { body, json, requireUser, type CodeContext } from "@/server/http";
import { markTableSeen } from "@/server/visits";

export async function POST(request: Request, context: CodeContext) {
  return json(async () => {
    const { user } = await requireUser();
    const { rev } = await body(request, z.object({ rev: z.number().int().min(0).max(2147483647) }).strict());
    return markTableSeen((await context.params).code, user.id, rev);
  });
}
