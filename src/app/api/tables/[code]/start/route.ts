import { json, requireUser, type CodeContext } from "@/server/http";
import { startGame } from "@/server/tables";

export async function POST(_request: Request, context: CodeContext) {
  return json(async () => {
    const { user } = await requireUser();
    return startGame((await context.params).code, user.id);
  });
}
