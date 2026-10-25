import { json, requireUser, type CodeContext } from "@/server/http";
import { joinTable } from "@/server/tables";

export async function POST(_request: Request, context: CodeContext) {
  return json(async () => {
    const { user } = await requireUser();
    return joinTable((await context.params).code, user.id);
  });
}
