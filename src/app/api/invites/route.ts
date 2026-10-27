import { json, requireUser } from "@/server/http";
import { listInvites } from "@/server/groups";

/** The lobby refetches its invitations here when nudged over Realtime or when the tab regains focus. */
export async function GET() {
  return json(async () => {
    const { user } = await requireUser();
    // Only friends are invited, and guests have none.
    return user.is_anonymous ? [] : listInvites(user.id);
  });
}
