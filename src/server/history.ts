import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Team } from "@/engine/types";
import { checkDb } from "./errors";

interface ResultSeat { seat: number; user_id: string | null; name: string; bot: boolean }
interface ResultRow {
  game_id: string; code: string; finished_at: string; score: Record<string, number>;
  abandoned: boolean; hands: number; seats: ResultSeat[];
  game_result_players: { team: string; won: boolean | null }[];
}
export interface HistoryEntry {
  gameId: string; code: string; finishedAt: string;
  /** pinochle: by team; hearts: by seat */
  score: Record<string, number>;
  kind: "pinochle" | "hearts";
  myTeam: Team; won: boolean; abandoned: boolean; hands: number; partner: string; opponents: [string, string];
  /** hearts: everyone at the table in seat order, with their final score */
  players?: { seat: number; name: string; me: boolean; score: number }[];
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
    const hearts = player.team.startsWith("s");
    const partner = result.seats.find(seat => seat.seat === (mine.seat + 2) % 4);
    const opponents = result.seats.filter(seat => seat.seat % 2 !== mine.seat % 2).sort((a, b) => a.seat - b.seat);
    return {
      gameId: result.game_id, code: result.code, finishedAt: result.finished_at, score: result.score, kind: hearts ? "hearts" : "pinochle",
      myTeam: hearts ? (mine.seat % 2 === 0 ? "red" : "blue") : player.team as Team,
      won: !result.abandoned && player.won === true, abandoned: result.abandoned, hands: result.hands, partner: partner?.name ?? "Empty seat",
      opponents: [opponents[0]?.name ?? "Empty seat", opponents[1]?.name ?? "Empty seat"],
      ...(hearts ? { players: [...result.seats].sort((a, b) => a.seat - b.seat).map(seat => ({ seat: seat.seat, name: seat.name, me: seat.user_id === userId, score: result.score[seat.seat] ?? 0 })) } : {}),
    };
  });
}
