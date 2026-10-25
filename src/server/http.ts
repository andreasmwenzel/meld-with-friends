import "server-only";
import { z } from "zod";
import { unstable_rethrow } from "next/navigation";
import { IllegalAction } from "@/engine/types";
import { createClient } from "@/lib/supabase/server";
import { ApiError } from "./errors";
import { isBanned } from "./bans";

export type CodeContext = { params: Promise<{ code: string }> };
export type IdContext = { params: Promise<{ id: string }> };

export async function body<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  let value: unknown;
  try { value = await request.json(); } catch (error) {
    unstable_rethrow(error);
    throw new ApiError(400, "Invalid JSON body");
  }
  return schema.parse(value);
}

export async function requireUser({ allowBanned = false }: { allowBanned?: boolean } = {}) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new ApiError(401, "Authentication required");
  if (!allowBanned && await isBanned(user.id)) throw new ApiError(403, "This account is suspended.");
  return { user, supabase };
}

export async function json(work: () => Promise<unknown>, status = 200) {
  try {
    return Response.json(await work(), { status, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    unstable_rethrow(error);
    const status = error instanceof ApiError ? error.status : error instanceof z.ZodError ? 400 : error instanceof IllegalAction ? 422 : 500;
    const message = error instanceof z.ZodError ? error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; ")
      : error instanceof ApiError || error instanceof IllegalAction ? error.message : "Internal server error";
    if (status === 500) console.error(error);
    return Response.json(error instanceof ApiError && error.data !== undefined ? error.data : { error: message }, { status, headers: { "Cache-Control": "private, no-store" } });
  }
}
