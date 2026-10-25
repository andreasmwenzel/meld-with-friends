import { bump } from "@/server/metrics";
import { json, requireUser, type CodeContext } from "@/server/http";
import { getView } from "@/server/game";

export async function GET(request: Request, context: CodeContext) {
  return json(async () => {
    if (request.headers.get("x-meld-resync") === "1") bump("resync_view");
    const { user } = await requireUser();
    return getView((await context.params).code, user.id);
  });
}
