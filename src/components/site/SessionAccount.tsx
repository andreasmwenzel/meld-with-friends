import { getSessionUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AccountMenu } from "./AccountMenu";

/** The account menu for whoever is signed in, read on the server; nothing for a visitor without a session. */
export async function SessionAccount() {
  const user = await getSessionUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data: profile } = await supabase.from("profiles").select("id, handle, display_name, avatar_seed").eq("id", user.id).single();
  return profile ? <AccountMenu me={profile} guest={!!user.is_anonymous} /> : null;
}
