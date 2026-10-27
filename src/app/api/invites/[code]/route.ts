import { json, requireUser, type CodeContext } from "@/server/http";
import { dismissInvite } from "@/server/groups";

export async function DELETE(_request: Request, context: CodeContext) {
  return json(async () => {
    const { user } = await requireUser();
    return dismissInvite((await context.params).code, user.id);
  });
}
