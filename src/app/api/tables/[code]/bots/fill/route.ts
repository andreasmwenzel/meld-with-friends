import { requireSavedAccount } from "@/server/admin";
import { json, requireUser, type CodeContext } from "@/server/http";
import { fillBots } from "@/server/tables";
export async function POST(_request: Request, context: CodeContext) {
  return json(async () => {
    const { user } = await requireUser();
    requireSavedAccount(user);
    return fillBots((await context.params).code, user.id);
  });
}
