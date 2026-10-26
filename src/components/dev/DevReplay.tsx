"use client";

import { useEffect, useState } from "react";
import { applyAction, newGame, type Action, type GameState, type SeatIndex } from "@/engine";
import { actors, botAction } from "@/engine/scenario";
import { buildReplay, type ReplayPayload } from "@/engine/replay";
import { ReplayView } from "@/components/replay/Replay";

const NAMES = ["Alice", "Mabel", "Bob", "Otto"];

/**
 * ?seed= picks the deals, ?hands= stops after that many finished hands plus a little of the next
 * (an unfinished game), ?seat= is the reader's seat, ?target= shortens the game.
 */
function generate(qs: URLSearchParams): ReplayPayload {
  const seed = qs.get("seed") ?? "dev-replay";
  const stopAt = qs.has("hands") ? Number(qs.get("hands")) : null;
  const target = qs.has("target") ? Number(qs.get("target")) : 100;
  let state = newGame(seed, { scoring: "modern", target, shoot: "points" }, 1);
  const states: GameState[] = [state];
  const actions: Action[] = [];
  let extra = 0;
  for (let guard = 0; guard < 6000 && state.phase !== "game_over"; guard++) {
    if (stopAt !== null && state.history.length >= stopAt && state.phase !== "hand_over" && ++extra > 5) break;
    const seat = actors(state)[0] ?? (0 as SeatIndex);
    const action: Action = state.phase === "hand_over" ? { type: "next_hand", seat } : botAction(state, seat);
    state = applyAction(state, action);
    states.push(state); actions.push(action);
  }
  const replay = buildReplay(states, actions);
  if (!replay) throw new Error("No completed hand to replay");
  const viewer = qs.has("seat") ? (Number(qs.get("seat")) as SeatIndex) : null;
  return {
    ...replay, gameId: "dev", code: "DEV000", viewerSeat: viewer,
    seats: NAMES.map((name, seat) => ({ seat: seat as SeatIndex, name, bot: seat % 2 === 1 })),
    startedAt: new Date(0).toISOString(), finishedAt: replay.finished ? new Date().toISOString() : null,
  };
}

export function DevReplay() {
  const [payload, setPayload] = useState<ReplayPayload | null>(null);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- generated once on the client from the URL
  useEffect(() => { setPayload(generate(new URLSearchParams(window.location.search))); }, []);
  if (!payload) return <p className="px-6 py-10 text-chalk-faint">The computers are playing a game for you.</p>;
  return <main className="flex flex-1 flex-col"><ReplayView payload={payload} /></main>;
}
