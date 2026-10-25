import { createClient } from "@/lib/supabase/server";
import { unstable_rethrow } from "next/navigation";

/** The signed-in auth user, or null. Safe to call from server components and route handlers. */
export async function getSessionUser() {
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    return data.user ?? null;
  } catch (error) {
    unstable_rethrow(error);
    // Missing env (e.g. first local run before Supabase is configured) should not crash the landing page.
    return null;
  }
}
