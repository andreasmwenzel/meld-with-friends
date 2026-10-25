import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { tableByCode } from "./tables";
import { checkDb } from "./errors";

export async function markTableSeen(code: string, userId: string, rev: number) {
  const table = await tableByCode(code);
  const { data, error } = await createAdminClient().rpc("mark_table_seen", {
    p_table: table.id, p_user: userId, p_rev: rev,
  });
  checkDb(error);
  return { lastSeenRev: data as number };
}
