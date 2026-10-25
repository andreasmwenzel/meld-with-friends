import { bump } from "@/server/metrics";
import { z } from "zod";
import { body, json, requireUser, type CodeContext } from "@/server/http";
import { actionSchema } from "@/server/validation";
import { act } from "@/server/game";

export async function POST(request: Request, context: CodeContext) {
  return json(async () => {
    bump("act");
    const { user } = await requireUser();
    const { action, expectedRev, requestId } = await body(request, z.object({ action: actionSchema, expectedRev: z.number().int().nonnegative(), requestId: z.uuid() }).strict());
    return act((await context.params).code, user.id, action, expectedRev, requestId);
  });
}
