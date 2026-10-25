import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Phase } from "@/engine/types";
import { ApiError, checkDb } from "./errors";
import { broadcastTable } from "./realtime";
import { codeSchema } from "./validation";

type Status = "open" | "playing" | "finished";
interface InspectorRow {
  code: string; status: Status; created_at: string;
  hostProfile: { handle: string } | null;
  seats: { seat: number; bot: string | null; profile: { display_name: string } | null }[];
  game: { updated_at: string; rev: number; phase: Phase } | null;
}
export async function listTables({ status, limit = 50 }: { status?: Status; limit?: number } = {}) {
  let query = createAdminClient().from("tables")
    .select("code,status,created_at,hostProfile:profiles!tables_host_fkey(handle),seats(seat,bot,profile:profiles(display_name)),game:games!tables_current_game_id_fkey(updated_at,rev,phase:state->>phase)")
    .order("created_at", { ascending: false }).limit(limit);
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  checkDb(error);
  return (data as unknown as InspectorRow[] ?? []).map(table => ({
    code: table.code, status: table.status, hostHandle: table.hostProfile?.handle ?? null,
    seats: table.seats.sort((a, b) => a.seat - b.seat).map(seat => ({
      seat: seat.seat, name: seat.profile?.display_name ?? seat.bot ?? null, bot: seat.bot !== null,
    })),
    createdAt: table.created_at, lastActivity: table.game?.updated_at ?? table.created_at,
    rev: table.game?.rev ?? null, phase: table.game?.phase ?? null,
  }));
}

export async function forceFinish(code: string) {
  const { data, error } = await createAdminClient().from("tables").update({ status: "finished" })
    .eq("code", codeSchema.parse(code)).select("code").maybeSingle();
  checkDb(error);
  if (!data) throw new ApiError(404, "Table not found");
  await broadcastTable(data.code, { type: "seats" });
  return { code: data.code as string, status: "finished" as const };
}
