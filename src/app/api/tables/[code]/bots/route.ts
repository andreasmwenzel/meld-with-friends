import { requireSavedAccount } from "@/server/admin";
import { z } from "zod";
import { body, json, requireUser, type CodeContext } from "@/server/http";
import { seatSchema } from "@/server/validation";
import { addBot, removeBot } from "@/server/tables";
export async function POST(request: Request, context: CodeContext) {
  return json(async () => {
    const { user } = await requireUser();
    requireSavedAccount(user);
    const { seat } = await body(request, z.object({ seat: seatSchema }).strict());
    return addBot((await context.params).code, seat, user.id);
  });
}
export async function DELETE(request: Request, context: CodeContext) {
  return json(async () => {
    const { user } = await requireUser();
    const { seat } = await body(request, z.object({ seat: seatSchema }).strict());
    return removeBot((await context.params).code, seat, user.id);
  });
}
