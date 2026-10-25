import { z } from "zod";
import { body } from "@/server/http";
import { json, requireUser, type CodeContext } from "@/server/http";
import { controlTable } from "@/server/tables";

export async function POST(request: Request, context: CodeContext) {
  return json(async () => {
    const { user } = await requireUser();
    const { toUserId } = await body(request, z.object({ toUserId: z.uuid() }).strict());
    return controlTable((await context.params).code, user.id, "host", toUserId);
  });
}
