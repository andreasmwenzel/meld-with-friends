import { json, type IdContext } from "@/server/http";
import { enforce } from "@/server/limits";
import { getSettings } from "@/server/settings";
import { getReplay } from "@/server/replay";
import { getSessionUser } from "@/lib/auth";

/** First hop of the forwarded chain, or a shared key when no proxy is involved (local dev). */
function clientKey(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
}

/** Public: whoever holds a game's link may replay its completed hands. No session is needed. */
export async function GET(request: Request, context: IdContext) {
  return json(async () => {
    await enforce(`replay:${clientKey(request)}`, (await getSettings()).limits.replaysPerHour, 3600);
    const user = await getSessionUser();
    return getReplay((await context.params).id, user?.id ?? null);
  });
}
