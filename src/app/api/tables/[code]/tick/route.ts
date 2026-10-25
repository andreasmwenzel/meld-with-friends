import { json, requireUser, type CodeContext } from "@/server/http";
import { tickForHuman } from "@/server/game";
export async function POST(_request: Request, context: CodeContext) {
  return json(async () => {
    const { user } = await requireUser();
    return tickForHuman((await context.params).code, user.id);
  });
}
