"use client";

import { useState } from "react";
import { HeartsBoard, type LocalHearts } from "@/components/hearts/HeartsBoard";
import { applyHeartsAction, chooseHeartsAction, heartsViewFor, newHeartsGame } from "@/engine/hearts";
import type { HeartsAction, HeartsState, SeatIndex } from "@/engine/hearts/types";
import type { Snapshot } from "@/components/table/types";

const NAMES = ["Andreas", "Priya", "Walt", "Nell"];
const ME = "u0";
const snapshot: Snapshot = {
  table: { id: "dev", code: "HRTSQN", host: ME, game_kind: "hearts", status: "playing", rules: {}, current_game_id: "dev-game" },
  seats: [
    { seat: 0, user_id: ME, bot: null, profile: { id: ME, handle: "andreas", display_name: NAMES[0], avatar_seed: "0" } },
    { seat: 1, user_id: null, bot: NAMES[1], profile: null },
    { seat: 2, user_id: null, bot: NAMES[2], profile: null },
    { seat: 3, user_id: null, bot: NAMES[3], profile: null },
  ],
  offers: [], mySeat: 0, ready: [], paused: null,
};

/** Puts the table in a named position by playing the computer players from a fresh deal. */
function position(name: string, seed: string): HeartsState {
  let s = newHeartsGame(seed, {}, 3);
  const botsPass = () => { for (const seat of [1, 2, 3] as SeatIndex[]) if (s.phase === "passing" && !s.players[seat].passed) s = applyHeartsAction(s, chooseHeartsAction(heartsViewFor(s, seat), `${seed}:${s.rev}`)); };
  const passAll = () => { botsPass(); if (s.phase === "passing") s = applyHeartsAction(s, chooseHeartsAction(heartsViewFor(s, 0), seed)); };
  const playUntil = (stop: (st: HeartsState) => boolean) => {
    for (let i = 0; i < 4000 && !stop(s); i++) {
      if (s.phase === "hand_over") { s = applyHeartsAction(s, { type: "next_hand", seat: 0 }); continue; }
      if (s.phase === "passing") { passAll(); continue; }
      if (s.phase !== "playing" || s.turn === null) break;
      s = applyHeartsAction(s, chooseHeartsAction(heartsViewFor(s, s.turn), `${seed}:${s.rev}`));
    }
  };
  switch (name) {
    case "passing": botsPass(); break;
    case "play": passAll(); playUntil((st) => st.phase === "playing" && st.turn === 0 && st.tricks.length >= 3); break;
    case "midhand": passAll(); playUntil((st) => st.phase === "playing" && st.turn === 0 && st.tricks.length >= 8); break;
    case "hand-over": playUntil((st) => st.phase === "hand_over"); break;
    case "moon": {
      // Bots seldom shoot; the position is written in on top of a finished hand so the moment can be seen.
      playUntil((st) => st.phase === "hand_over");
      const last = s.history[s.history.length - 1];
      const shooter: SeatIndex = 1;
      const delta = { 0: 26, 1: 0, 2: 26, 3: 26 } as Record<SeatIndex, number>;
      const score = { ...s.score };
      for (const seat of [0, 1, 2, 3] as SeatIndex[]) score[seat] += delta[seat] - last.delta[seat];
      s = { ...s, score, history: [...s.history.slice(0, -1), { ...last, moon: shooter, delta, taken: { 0: 0, 1: 26, 2: 0, 3: 0 } }],
        players: s.players.map((p) => ({ ...p, taken: p.seat === shooter ? ["QS", "2H", "3H", "4H", "5H", "6H", "7H", "8H", "9H", "TH", "JH", "QH", "KH", "AH"] : [] })) as HeartsState["players"] };
      break;
    }
    case "late": playUntil((st) => st.history.length >= 4 && st.phase === "playing" && st.turn === 0); break;
    case "game-over": playUntil((st) => st.phase === "game_over"); break;
  }
  return s;
}

export function DevHearts({ state, seed, run }: { state: string; seed: string; run: boolean }) {
  const [rev, setRev] = useState(0);
  // The driver keeps the game in a box of its own; the board only ever sees views of it.
  const [local] = useState<LocalHearts>(() => {
    const box = { s: position(state, seed) };
    const bot = (seat: SeatIndex) => { box.s = applyHeartsAction(box.s, chooseHeartsAction(heartsViewFor(box.s, seat), `${seed}:${box.s.rev}`)); };
    return {
      fetchView: async () => ({ ...heartsViewFor(box.s, 0), ready: [] }),
      act: async (action: HeartsAction) => { box.s = applyHeartsAction(box.s, action); return { ...heartsViewFor(box.s, 0), ready: [] }; },
      tick: async () => {
        if (!run) return;
        const s = box.s;
        if (s.phase === "passing") { for (const seat of [1, 2, 3] as SeatIndex[]) if (!box.s.players[seat].passed) bot(seat); }
        else if (s.phase === "playing" && s.turn !== null && s.turn !== 0) bot(s.turn);
        setRev((r) => r + 1);
      },
    };
  });
  return (
    <main className="flex h-dvh flex-col overflow-hidden">
      <HeartsBoard code="HRTSQN" me={{ id: ME, handle: "andreas", display_name: NAMES[0], avatar_seed: "0" }} snap={snapshot} onTableChange={() => {}} rev={rev} local={local} />
    </main>
  );
}
