import { z } from "zod";
import { body, json, requireUser, type IdContext } from "@/server/http";
import { idSchema } from "@/server/validation";
import { answerSeatTrade } from "@/server/tables";

export async function POST(request: Request, context: IdContext) {
  return json(async () => {
    const { user } = await requireUser();
    const { accept } = await body(request, z.object({ accept: z.boolean() }).strict());
    return answerSeatTrade(idSchema.parse((await context.params).id), accept, user.id);
  });
}
