import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveRules } from "@/engine/scoring";
import { buildReplay, rebuildFromLog, type ReplayPayload, type ReplaySeat } from "@/engine/replay";
import type { Action, GameState, SeatIndex } from "@/engine/types";
import { ApiError, checkDb } from "./errors";
import { idSchema } from "./validation";

export type { ReplayPayload, ReplaySeat };

interface GameRow { id: string; table_id: string; state: GameState; rev: number; created_at: string; updated_at: string }
interface SnapshotSeat { seat: SeatIndex; user_id: string | null; name: string; bot: boolean }

/**
 * A finished or in-progress game as a replay, for anyone holding its id. The id is an unguessable
 * uuid that only players receive, so holding it is the permission. Hands still being played are
 * never included, and the seed never leaves the server.
 */
export async function getReplay(gameId: string, viewerId: string | null): Promise<ReplayPayload> {
  if (!idSchema.safeParse(gameId).success) throw new ApiError(404, "No game has this link.");
  const admin = createAdminClient();
  const [gameResult, logResult, resultResult] = await Promise.all([
    admin.from("games").select("id,table_id,state,rev,created_at,updated_at").eq("id", gameId).maybeSingle(),
    admin.from("game_actions").select("action,rev").eq("game_id", gameId).order("rev", { ascending: true }),
    admin.from("game_results").select("code,seats,finished_at").eq("game_id", gameId).maybeSingle(),
  ]);
  checkDb(gameResult.error); checkDb(logResult.error); checkDb(resultResult.error);
  const game = gameResult.data as GameRow | null;
  if (!game) throw new ApiError(404, "No game has this link.");
  const finished = game.state.phase === "game_over";
  if (!finished && !resolveRules(game.state.rules, true).revealHands) {
    throw new ApiError(409, "This table keeps hands private until the game is over.");
  }
  const actions = ((logResult.data ?? []) as { action: Action }[]).map(row => row.action);
  const rebuilt = rebuildFromLog(game.state, actions);
  if (!rebuilt) throw new ApiError(422, "This game's record can no longer be replayed.");
  const replay = buildReplay(rebuilt.states, actions);
  if (!replay) throw new ApiError(404, "No hand has finished yet. Come back after the first hand.");

  const result = resultResult.data as { code: string; seats: SnapshotSeat[]; finished_at: string } | null;
  let code: string, chairs: SnapshotSeat[];
  if (result) { code = result.code; chairs = result.seats; }
  else {
    const [tableResult, seatResult] = await Promise.all([
      admin.from("tables").select("code").eq("id", game.table_id).maybeSingle(),
      admin.from("seats").select("seat,user_id,bot,profile:profiles(display_name)").eq("table_id", game.table_id).order("seat"),
    ]);
    checkDb(tableResult.error); checkDb(seatResult.error);
    if (!tableResult.data) throw new ApiError(404, "No game has this link.");
    code = tableResult.data.code as string;
    type LiveSeat = { seat: SeatIndex; user_id: string | null; bot: string | null; profile: { display_name: string } | null };
    chairs = ((seatResult.data ?? []) as unknown as LiveSeat[]).map(s => ({
      seat: s.seat, user_id: s.user_id, name: s.profile?.display_name || s.bot || "Empty seat", bot: !!s.bot && !s.user_id,
    }));
  }
  const seats: ReplaySeat[] = ([0, 1, 2, 3] as SeatIndex[]).map(seat => {
    const chair = chairs.find(c => c.seat === seat);
    return { seat, name: chair?.name || "Empty seat", bot: chair?.bot ?? false };
  });
  const viewerSeat = viewerId === null ? null : chairs.find(c => c.user_id === viewerId)?.seat ?? null;
  return {
    ...replay, gameId: game.id, code, seats, viewerSeat,
    startedAt: game.created_at, finishedAt: finished ? result?.finished_at ?? game.updated_at : null,
  };
}
