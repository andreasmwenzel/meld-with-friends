import { z } from "zod";
import { body, json, requireUser } from "@/server/http";
import { rulesSchema } from "@/server/validation";
import { createTable } from "@/server/tables";
import { assertOwnGroup, inviteGroup } from "@/server/groups";

export async function POST(request: Request) {
  return json(async () => {
    const { user } = await requireUser();
    const input = await body(request, z.object({ gameKind: z.literal("pinochle").default("pinochle"), rules: rulesSchema.default({}), groupId: z.uuid().optional() }).strict());
    if (!input.groupId) return createTable(input.gameKind, input.rules, user.id);
    await assertOwnGroup(input.groupId, user.id);
    const table = await createTable(input.gameKind, input.rules, user.id);
    // The table is dealt either way; a failed invitation must not hide its code from the host.
    const invited = await inviteGroup(table.id, input.groupId, user.id).catch((error: unknown) => { console.error("invite_group", error); return null; });
    return { ...table, invited };
  }, 201);
}
