import { z } from "zod";
import { body, json, requireUser, type CodeContext } from "@/server/http";
import { getTableSnapshot, updateTableRules } from "@/server/tables";
import { rulesSchema } from "@/server/validation";

export async function GET(_request: Request, context: CodeContext) {
  return json(async () => {
    const { user } = await requireUser();
    return getTableSnapshot((await context.params).code, user.id);
  });
}

export async function PATCH(request: Request, context: CodeContext) {
  return json(async () => {
    const { user } = await requireUser();
    const input = await body(request, z.object({ rules: rulesSchema }).strict());
    return updateTableRules((await context.params).code, input.rules, user.id);
  });
}
