"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { applyAction, newPracticeGame, viewFor, type Action, type GameState, type PlayerView, type SeatIndex } from "@/engine";
import { chooseAction } from "@/engine/ai";
import { Game } from "@/components/table/Game";
import { useCardPrefs } from "@/lib/cardPrefs";
import type { Snapshot } from "@/components/table/types";
import { Coach } from "./Coach";
import { PracticeRules } from "./PracticeRules";
import { PRACTICE_NAMES } from "./coach";

const CODE = "PRCTCE";
const SEATS: SeatIndex[] = [0, 1, 2, 3];
const snap: Snapshot = {
  table: { id: "practice", code: CODE, host: "you", status: "playing", rules: {} },
  seats: SEATS.map((seat) => ({
    seat, user_id: `p${seat}`, bot: null,
    profile: { id: `p${seat}`, handle: PRACTICE_NAMES[seat].toLowerCase(), display_name: PRACTICE_NAMES[seat], avatar_seed: PRACTICE_NAMES[seat] },
  })),
  offers: [], mySeat: 0,
};
const me = snap.seats[0].profile!;
const fresh = () => newPracticeGame();

/** Which computer seat has something to do right now, if any. */
function botSeat(s: GameState): SeatIndex | null {
  if (s.phase === "hand_over" || s.phase === "game_over" || s.phase === "dealing") return null;
  if (s.phase === "melding") return SEATS.find((x) => x !== 0 && !s.players[x].meldConfirmed) ?? null;
  return s.turn !== null && s.turn !== 0 ? s.turn : null;
}

export function PracticeBoard() {
  // Mount the local session after the browser's fetch shim is installed.
  const [state, setState] = useState<GameState | null>(null);
  const [started, setStarted] = useState(false);
  const [game, setGame] = useState(0);
  const latest = useRef<GameState | null>(null);
  const { prefs } = useCardPrefs();

  const commit = useCallback((s: GameState) => { latest.current = s; setState(s); }, []);

  // Route the board's /view and /act calls to the local engine; nothing leaves the browser.
  useEffect(() => {
    const real = window.fetch;
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!url.includes(`/api/tables/${CODE}`)) return real.call(window, input, init);
      if (url.endsWith("/view")) return Response.json(viewFor(latest.current!, 0));
      if (url.endsWith("/tick")) return Response.json({ acted: false, rev: latest.current!.rev });
      if (url.endsWith("/act")) {
        try {
          const { action } = JSON.parse(String(init?.body)) as { action: Action };
          commit(applyAction(latest.current!, { ...action, seat: 0 } as Action));
          return Response.json(viewFor(latest.current!, 0));
        } catch (e) { return Response.json({ error: (e as Error).message }, { status: 422 }); }
      }
      return Response.json({ error: "Not available in a practice hand." }, { status: 400 });
    };
    commit(fresh()); // eslint-disable-line react-hooks/set-state-in-effect -- the board mounts only after the shim and the deal are in place
    return () => { window.fetch = real; };
  }, [commit]);

  // The computers take one move at a time so each trick can be followed.
  useEffect(() => {
    if (!started || !state) return;
    const seat = botSeat(state);
    if (seat === null) return;
    const timer = setTimeout(() => {
      try {
        const s = latest.current!;
        if (botSeat(s) !== seat) return;
        const action = chooseAction(viewFor(s, seat), { seed: `${s.rev}`, config: { samples: 8, budgetMs: 5 } });
        commit(applyAction(s, action));
      } catch { /* a stuck computer would be a bug; the learner can start over */ }
    }, 700);
    return () => clearTimeout(timer);
  }, [started, state, commit]);

  const layDown = useCallback(() => {
    let s = latest.current;
    if (!s) return;
    const v = viewFor(s, 0);
    if (v.legal.canDeclareMeld) s = applyAction(s, { type: "declare_meld", seat: 0, cards: v.hand });
    if (viewFor(s, 0).legal.canConfirmMeld) s = applyAction(s, { type: "confirm_meld", seat: 0 });
    commit(s);
  }, [commit]);

  const startOver = () => { commit(fresh()); setGame((g) => g + 1); };

  if (!state) return <div className="min-h-[60vh]" />;
  if (!started) return <PracticeRules rules={state.rules} onStart={() => setStarted(true)} />;
  const view: PlayerView = viewFor(state, 0);
  // With automatic meld the table lays it down itself; a second button would race it.
  const canLay = !prefs.autoMeld && view.phase === "melding" && !view.meldConfirmed[0] && (view.legal.canDeclareMeld || view.legal.canConfirmMeld);

  return (
    <div className="mx-auto w-full max-w-[1500px] lg:grid lg:grid-cols-[300px_minmax(0,1fr)] lg:gap-2 lg:px-6">
      <Coach view={view} canLay={canLay} autoMeld={prefs.autoMeld} onLayDown={layDown} onStartOver={startOver} />
      <div className="min-w-0">
        <Game local key={game} code={CODE} me={me} snap={{ ...snap, table: { ...snap.table, rules: { ...state.rules } } }} rev={state.rev} onTableChange={() => {}} />
      </div>
    </div>
  );
}
