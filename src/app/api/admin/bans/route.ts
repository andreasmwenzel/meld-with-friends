import { z } from "zod";
import { body, json } from "@/server/http";
import { requireAdmin } from "@/server/admin";
import { ban, unban, listBans } from "@/server/bans";
import { handleSchema } from "@/server/validation";
const banSchema = z.object({
  handle: handleSchema.optional(), userId: z.uuid().optional(), reason: z.string().trim().max(1000).optional(),
}).strict().refine(value => !!value.handle !== !!value.userId, "Provide exactly one of handle or userId");
export async function GET() {
  return json(async () => { await requireAdmin(); return listBans(); });
}
export async function POST(request: Request) {
  return json(async () => {
    await requireAdmin();
    const input = await body(request, banSchema);
    return ban(input.userId ?? input.handle!, input.reason);
  });
}
export async function DELETE(request: Request) {
  return json(async () => {
    await requireAdmin();
    return unban((await body(request, z.object({ userId: z.uuid() }).strict())).userId);
  });
}
