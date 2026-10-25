import { z } from "zod";
import { body, json, requireUser } from "@/server/http";
import { rulesSchema } from "@/server/validation";
import { createTable } from "@/server/tables";

export async function POST(request: Request) {
  return json(async () => {
    const { user } = await requireUser();
    const input = await body(request, z.object({ gameKind: z.literal("pinochle").default("pinochle"), rules: rulesSchema.default({}) }).strict());
    return createTable(input.gameKind, input.rules, user.id);
  }, 201);
}
