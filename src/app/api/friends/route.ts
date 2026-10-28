import { z } from "zod";
import { body, json, requireUser } from "@/server/http";
import { handleSchema } from "@/server/validation";
import { ApiError } from "@/server/errors";
import { getFriends, requestFriend } from "@/server/friends";

export async function GET() {
  return json(async () => getFriends((await requireUser()).user.id));
}
export async function POST(request: Request) {
  return json(async () => {
    const { user } = await requireUser();
    // A guest is never a friend on either side: they save their account first, as for groups.
    if (user.is_anonymous !== false) throw new ApiError(403, "Save your account to add friends");
    const target = await body(request, z.union([z.object({ handle: handleSchema }).strict(), z.object({ userId: z.uuid() }).strict()]));
    return requestFriend("handle" in target ? target.handle : target, user.id);
  }, 201);
}
