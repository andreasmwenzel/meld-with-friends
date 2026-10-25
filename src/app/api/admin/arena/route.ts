import { z } from "zod";
import { body, json } from "@/server/http";
import { requireAdmin } from "@/server/admin";
import { getSettings } from "@/server/settings";
import { arena } from "@/engine/ai/arena";
export async function POST(request: Request) {
  return json(async () => {
    await requireAdmin();
    const { games } = await body(request, z.object({ games: z.number().int().min(1).max(40) }).strict());
    // Heuristic-only play keeps 40 full games within the function's compute budget.
    return arena(games, 1, "admin-arena", (await getSettings()).bots);
  });
}
