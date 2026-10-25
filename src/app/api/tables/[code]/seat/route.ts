import { z } from "zod";
import { body, json, requireUser, type CodeContext } from "@/server/http";
import { seatSchema } from "@/server/validation";
import { takeSeat, leaveSeat } from "@/server/tables";

export async function POST(request: Request, context: CodeContext) {
  return json(async () => {
    const { user } = await requireUser();
    const { seat } = await body(request, z.object({ seat: seatSchema }).strict());
    return takeSeat((await context.params).code, seat, user.id);
  });
}
export async function DELETE(_request: Request, context: CodeContext) {
  return json(async () => {
    const { user } = await requireUser();
    return leaveSeat((await context.params).code, user.id);
  });
}
