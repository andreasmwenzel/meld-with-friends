import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { tableByCode } from "./tables";
import { checkDb } from "./errors";

/** Records how far a seated player has read, and the automatic-meld choice their browser reports. */
export async function markTableSeen(code: string, userId: string, rev: number, autoMeld?: boolean) {
  const table = await tableByCode(code);
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("mark_table_seen", {
    p_table: table.id, p_user: userId, p_rev: rev,
  });
  checkDb(error);
  if (autoMeld !== undefined) {
    // Best effort: a failed write leaves the last choice in place and must not fail the seen report.
    const saved = await admin.from("profiles").update({ auto_meld: autoMeld }).eq("id", userId).neq("auto_meld", autoMeld);
    if (saved.error) console.error("Auto meld preference failed", saved.error);
  }
  return { lastSeenRev: data as number };
}
