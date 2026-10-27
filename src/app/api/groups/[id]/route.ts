import { z } from "zod";
import { body, json, requireUser, type IdContext } from "@/server/http";
import { deleteGroup, renameGroup, setGroupMembers } from "@/server/groups";

export async function PATCH(request: Request, context: IdContext) {
  return json(async () => {
    const { user } = await requireUser();
    const input = await body(request, z.union([z.object({ name: z.string() }).strict(), z.object({ members: z.array(z.string()) }).strict()]));
    const { id } = await context.params;
    return "name" in input ? renameGroup(id, input.name, user) : setGroupMembers(id, input.members, user);
  });
}
export async function DELETE(_request: Request, context: IdContext) {
  return json(async () => {
    const { user } = await requireUser();
    return deleteGroup((await context.params).id, user);
  });
}
