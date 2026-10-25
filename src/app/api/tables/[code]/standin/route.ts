import { z } from "zod";
import { requireSavedAccount } from "@/server/admin";
import { body, json, requireUser, type CodeContext } from "@/server/http";
import { standIn } from "@/server/tables";
import { seatSchema } from "@/server/validation";

export async function POST(request: Request, context: CodeContext) {
  return json(async () => {
    const { user } = await requireUser();
    requireSavedAccount(user);
    const { seat } = await body(request, z.object({ seat: seatSchema }).strict());
    return standIn((await context.params).code, seat, user.id);
  });
}
