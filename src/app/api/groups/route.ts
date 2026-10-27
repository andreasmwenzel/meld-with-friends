import { z } from "zod";
import { body, json, requireUser } from "@/server/http";
import { createGroup, getGroups } from "@/server/groups";

export async function GET() {
  return json(async () => getGroups((await requireUser()).user.id));
}
export async function POST(request: Request) {
  return json(async () => {
    const { user } = await requireUser();
    const input = await body(request, z.object({ name: z.string(), members: z.array(z.string()).default([]) }).strict());
    return createGroup(input.name, input.members, user);
  }, 201);
}
