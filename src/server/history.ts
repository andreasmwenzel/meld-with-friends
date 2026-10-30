import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Team } from "@/engine/types";
import { checkDb } from "./errors";

interface ResultSeat { seat: number; user_id: string | null; name: string; bot: boolean }
interface ResultRow {
  game_id: string; code: string; finished_at: string; score: Record<Team, number>;
  abandoned: boolean; hands: number; seats: ResultSeat[];
  game_result_players: { team: Team; won: boolean | null }[];
}
export interface HistoryEntry {
  gameId: string; code: string; finishedAt: string; score: Record<Team, number>;
  myTeam: Team; won: boolean; abandoned: boolean; hands: number; partner: string; opponents: [string, string];
}

/** The RPC snapshots state and seats and inserts both result tables atomically. */
export async function recordGameResult(gameId: string): Promise<void> {
  const { error } = await createAdminClient().rpc("record_game_result", { p_game: gameId });
  checkDb(error);
}

export async function listHistory(userId: string, limit = 50): Promise<HistoryEntry[]> {
  const { data, error } = await createAdminClient().from("game_results")
    .select("game_id,code,finished_at,score,hands,seats,abandoned,game_result_players!inner(team,won)")
    .eq("game_result_players.user_id", userId).order("finished_at", { ascending: false }).limit(limit);
  checkDb(error);
  return (data as unknown as ResultRow[] ?? []).map(result => {
    const player = result.game_result_players[0];
    const mine = result.seats.find(seat => seat.user_id === userId)!;
    const partner = result.seats.find(seat => seat.seat === (mine.seat + 2) % 4);
    const opponents = result.seats.filter(seat => seat.seat % 2 !== mine.seat % 2).sort((a, b) => a.seat - b.seat);
    return {
      gameId: result.game_id, code: result.code, finishedAt: result.finished_at, score: result.score,
      myTeam: player.team, won: !result.abandoned && player.won === true, abandoned: result.abandoned, hands: result.hands, partner: partner?.name ?? "Empty seat",
      opponents: [opponents[0]?.name ?? "Empty seat", opponents[1]?.name ?? "Empty seat"],
    };
  });
}
