import { z } from "zod";
import { body, json, requireUser, type CodeContext } from "@/server/http";
import { idSchema } from "@/server/validation";
import { offerSeatTrade } from "@/server/tables";

export async function POST(request: Request, context: CodeContext) {
  return json(async () => {
    const { user } = await requireUser();
    const { toUserId } = await body(request, z.object({ toUserId: idSchema }).strict());
    return offerSeatTrade((await context.params).code, toUserId, user.id);
  }, 201);
}
