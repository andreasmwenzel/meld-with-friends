import "server-only";
import { after } from "next/server";
import type { Action, GameState } from "@/engine/types";
import { pickTableTalk, talkDue, type TalkFacts, type TalkSeat } from "@/lib/bots/tableTalk";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkDb } from "./errors";
import { broadcastChat } from "./realtime";

type Table = { id: string; code: string };

/** Call only after the revision-guarded commit succeeds, never on a retry/no-op. */
export function scheduleHandTalk(table: Table, gameId: string, prev: GameState, next: GameState, action: Action) {
  try {
    const scored = next.history.length === prev.history.length + 1;
    const redealt = prev.phase === "bidding" && next.phase === "bidding" && next.handNumber > prev.handNumber
      && (action.type === "misdeal" || action.type === "pass_bid");
    if ((!scored && !redealt) || !talkDue(table.id, prev.handNumber)) return;
    // Copy only the public result into the closure. No GameState/private view reaches the picker.
    const facts: TalkFacts | "redeal" = scored ? {
      hand: next.history[next.history.length - 1], score: next.score, winner: next.winner,
      minBid: next.rules.minBid, scale: next.rules.scoring === "modern" ? 0.1 : 1,
    } : "redeal";
    schedule(table, `${gameId}:hand:${prev.handNumber}`, facts);
  } catch (error) { console.error("Bot table talk scheduling failed", error); }
}

export function scheduleRematchTalk(table: Table, previousGameId: string) {
  schedule(table, `${previousGameId}:rematch`, "rematch");
}

function schedule(table: Table, eventId: string, facts: TalkFacts | "redeal" | "rematch") {
  try {
    after(async () => {
      try {
        const { data, error } = await createAdminClient().from("seats")
          .select("seat,bot,user_id,profile:profiles(display_name)").eq("table_id", table.id)
          .abortSignal(AbortSignal.timeout(3000));
        checkDb(error);
        const seats: TalkSeat[] = (data ?? []).map(row => ({
          seat: row.seat, bot: Boolean(row.bot && !row.user_id),
          name: row.bot || (row.profile as unknown as { display_name: string } | null)?.display_name || "friend",
        }));
        const line = pickTableTalk(seats, eventId, facts);
        if (!line) return;
        await broadcastChat(table.code, {
          id: `bot:${eventId}`, from: `bot:${table.id}:${line.seat}`,
          name: line.name, text: line.text, at: Date.now(),
        });
      } catch (error) { console.error("Bot table talk failed", error); }
    });
  } catch (error) { console.error("Bot table talk scheduling failed", error); }
}
