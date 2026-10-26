import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Phase, SeatIndex, Team } from "@/engine/types";
import { sortTables, summarizeTable, type TableFacts, type TableSummary } from "@/lib/tableStatus";
import { checkDb } from "./errors";

interface Row {
  id: string; code: string; status: TableFacts["status"]; host: string; paused_by: string | null; created_at: string;
  seats: { seat: SeatIndex; user_id: string | null; bot: string | null; profile: { display_name: string } | null }[];
  game: {
    rev: number; updated_at: string; ready: SeatIndex[] | null; phase: Phase; turn: SeatIndex | null; winner: Team | null;
    score: Record<Team, number> | null; m0: boolean | null; m1: boolean | null; m2: boolean | null; m3: boolean | null;
  } | null;
}

/**
 * The player's unfinished tables with whose move it is. Reads only the public parts of each game
 * (phase, turn, score, meld confirmations) on the server; hands never leave the database.
 */
export async function listMyTables(userId: string): Promise<TableSummary[]> {
  const admin = createAdminClient();
  const mine = await admin.from("seats").select("table_id").eq("user_id", userId);
  checkDb(mine.error);
  const ids = (mine.data ?? []).map((s) => s.table_id as string);
  if (!ids.length) return [];
  const [tables, visits] = await Promise.all([
    admin.from("tables")
      .select("id,code,status,host,paused_by,created_at,seats(seat,user_id,bot,profile:profiles(display_name)),game:games!tables_current_game_id_fkey(rev,updated_at,ready,phase:state->>phase,turn:state->turn,winner:state->>winner,score:state->score,m0:state->players->0->meldConfirmed,m1:state->players->1->meldConfirmed,m2:state->players->2->meldConfirmed,m3:state->players->3->meldConfirmed)")
      .in("id", ids).neq("status", "finished"),
    admin.from("table_visits").select("table_id,last_rev").eq("user_id", userId).in("table_id", ids),
  ]);
  checkDb(tables.error); checkDb(visits.error);
  const seen = new Map((visits.data ?? []).map((v) => [v.table_id as string, v.last_rev as number]));
  const rows = (tables.data ?? []) as unknown as Row[];
  return sortTables(rows.flatMap((t) => {
    const g = t.game;
    const summary = summarizeTable({
      code: t.code, status: t.status, host: t.host, pausedBy: t.paused_by, createdAt: t.created_at,
      seats: t.seats.map((s) => ({ seat: s.seat, userId: s.user_id, bot: s.bot, name: s.profile?.display_name ?? s.bot })),
      game: g && {
        rev: g.rev, updatedAt: g.updated_at, phase: g.phase, turn: g.turn, winner: g.winner, score: g.score,
        meldConfirmed: [!!g.m0, !!g.m1, !!g.m2, !!g.m3], ready: g.ready ?? [],
      },
      lastSeenRev: seen.get(t.id) ?? null,
    }, userId);
    return summary ? [summary] : [];
  }));
}
