import { json, requireUser, type CodeContext } from "@/server/http";
import { getTablemates } from "@/server/friends";

export async function GET(_request: Request, context: CodeContext) {
  return json(async () => getTablemates((await context.params).code, (await requireUser()).user.id));
}
