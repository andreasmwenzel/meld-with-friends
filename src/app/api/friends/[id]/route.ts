import { z } from "zod";
import { body, json, requireUser, type IdContext } from "@/server/http";
import { idSchema } from "@/server/validation";
import { answerFriend, removeFriend } from "@/server/friends";

export async function POST(request: Request, context: IdContext) {
  return json(async () => {
    const { user } = await requireUser();
    const { accept } = await body(request, z.object({ accept: z.boolean() }).strict());
    return answerFriend(idSchema.parse((await context.params).id), accept, user.id);
  });
}
export async function DELETE(_request: Request, context: IdContext) {
  return json(async () => {
    const { user } = await requireUser();
    return removeFriend(idSchema.parse((await context.params).id), user.id);
  });
}
