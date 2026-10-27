import "server-only";
import webPush from "web-push";
import { Agent } from "node:https";
import { after } from "next/server";
import type { GameState, Phase } from "@/engine/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkDb } from "./errors";
import { bump } from "./metrics";

const sentences: Partial<Record<Phase, string>> = {
  bidding: "Your bid.", playing: "Your play.", melding: "Lay down your meld.",
  declaring_trump: "Choose trump.", passing_to_bidder: "Pass cards to your partner.",
  passing_back: "Pass cards back to your partner.",
  deciding_shoot: "Shoot the moon, or play it out?",
};

/** Called only after successful commits. after() keeps work alive on Vercel. */
export function scheduleTurnNotification(gameId: string) {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY || !process.env.VAPID_SUBJECT) return;
  after(() => notifyTurn(gameId));
}

/** Best effort, bounded to two seconds including database lookups. */
export async function notifyTurn(gameId: string): Promise<void> {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return;
  const controller = new AbortController();
  const agent = new Agent();
  controller.signal.addEventListener("abort", () => agent.destroy(), { once: true });
  const deadline = Date.now() + 2000;
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<void>(resolve => {
    timer = setTimeout(() => { controller.abort(); bump("push_fail"); resolve(); }, 2000);
  });
  const work = async () => {
    const db = createAdminClient();
    const signal = controller.signal;
    const game = await db.from("games").select("table_id,state").eq("id", gameId).abortSignal(signal).maybeSingle();
    checkDb(game.error);
    if (!game.data || signal.aborted) return;
    const state = game.data.state as GameState;
    const table = await db.from("tables").select("id,code,rules,current_game_id,paused_by,status").eq("id", game.data.table_id).abortSignal(signal).maybeSingle();
    checkDb(table.error);
    if (!table.data || table.data.rules?.pace !== "leisurely" || table.data.current_game_id !== gameId || table.data.paused_by) return;
    const row = table.data;
    const terminal = state.phase === "hand_over" || state.phase === "game_over";
    if (row.status !== "playing" && !(state.phase === "game_over" && row.status === "finished")) return;
    const sentence = sentences[state.phase];
    if (!terminal && !sentence) return;
    const seats = await db.from("seats").select("seat,user_id,bot").eq("table_id", row.id).abortSignal(signal);
    checkDb(seats.error);
    const humans = (seats.data ?? []).filter(seat => seat.user_id && !seat.bot && (terminal ||
      (state.phase === "melding" ? !state.players[seat.seat].meldConfirmed : seat.seat === state.turn)));
    await Promise.all(humans.map(async seat => {
      const subscriptions = await db.from("push_subscriptions").select("endpoint,keys").eq("user_id", seat.user_id).abortSignal(signal);
      checkDb(subscriptions.error);
      if (!subscriptions.data?.length || signal.aborted) return;
      const visit = await db.from("table_visits").select("last_seen").eq("table_id", row.id).eq("user_id", seat.user_id).abortSignal(signal).maybeSingle();
      checkDb(visit.error);
      if (visit.data && Date.parse(visit.data.last_seen) >= Date.now() - 120_000) return;
      const claim = await db.rpc("claim_push", {
        p_table: row.id, p_user: seat.user_id,
        p_event: terminal ? `${gameId}:${state.handNumber}:${state.phase}` : null,
      }).abortSignal(signal);
      checkDb(claim.error);
      if (!claim.data || signal.aborted) return;
      const payload = JSON.stringify({
        title: state.phase === "hand_over" ? `Hand over at ${row.code}` : state.phase === "game_over" ? `Game over at ${row.code}` : "Your turn at the table",
        body: `${row.code}: ${terminal ? (state.phase === "hand_over" ? "The hand is over." : "The game is over.") : sentence}`,
        url: `/t/${row.code}`,
      });
      await Promise.all(subscriptions.data.map(async subscription => {
        if (signal.aborted) return;
        try {
          await webPush.sendNotification(subscription, payload, {
            vapidDetails: { subject, publicKey, privateKey }, TTL: 600, agent,
            timeout: Math.max(1, deadline - Date.now()),
          });
          if (signal.aborted) return;
          bump("push_sent");
          if (!signal.aborted) {
            const result = await db.from("push_subscriptions").update({ last_ok: new Date().toISOString() }).eq("endpoint", subscription.endpoint).eq("user_id", seat.user_id).abortSignal(signal);
            checkDb(result.error);
          }
        } catch (error) {
          bump("push_fail");
          if (!signal.aborted && error && typeof error === "object" && "statusCode" in error && [404, 410].includes(Number(error.statusCode))) {
            const result = await db.from("push_subscriptions").delete().eq("endpoint", subscription.endpoint).eq("user_id", seat.user_id).abortSignal(signal);
            checkDb(result.error);
          }
        }
      }));
    }));
  };
  try { await Promise.race([work(), timeout]); }
  catch { bump("push_fail"); }
  finally { clearTimeout(timer!); controller.abort(); }
}
