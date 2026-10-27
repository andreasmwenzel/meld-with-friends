import { z } from "zod";
import { body, json, requireUser } from "@/server/http";
import { rulesSchema } from "@/server/validation";
import { createTable } from "@/server/tables";
import { notifyInvited } from "@/server/realtime";

export async function POST(request: Request) {
  return json(async () => {
    const { user } = await requireUser();
    const input = await body(request, z.object({ gameKind: z.literal("pinochle").default("pinochle"), rules: rulesSchema.default({}), groupId: z.uuid().optional() }).strict());
    if (!input.groupId) return createTable(input.gameKind, input.rules, user.id);
    // One transaction seats the host and invites the group; a failure deals nothing and reaches the host as an error.
    const { invited, ...table } = await createTable(input.gameKind, input.rules, user.id, input.groupId);
    await notifyInvited(invited ?? []);
    return { ...table, invited: invited?.length ?? 0 };
  }, 201);
}
