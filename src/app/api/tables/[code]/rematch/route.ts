import { json, requireUser, type CodeContext } from "@/server/http";
import { rematch } from "@/server/tables";

export async function POST(_request: Request, context: CodeContext) {
  return json(async () => {
    const { user } = await requireUser();
    return rematch((await context.params).code, user.id);
  });
}
