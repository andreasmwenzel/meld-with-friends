"use client";

import { useState } from "react";
import { api } from "@/lib/api";

interface ArenaResult { games: number; botWins: number; randomWins: number; avgDecisionMs: number; avgGameMs: number; avgBidMade: number }

/** Quick balance check: bots versus a random-legal-move team, with the saved settings. */
export function Arena() {
  const [games, setGames] = useState(10);
  const [result, setResult] = useState<ArenaResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run() {
    setBusy(true); setError(null);
    try { setResult(await api<ArenaResult>("/api/admin/arena", { body: { games } })); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <section>
      <h2 className="display" style={{ fontSize: 30 }}>Arena</h2>
      <p className="mt-1 text-sm text-chalk-faint">Plays computer players against a team that picks random legal moves, using the saved settings. Runs on the server, so keep batches small.</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="text-sm text-chalk-faint">Games
          <select className="field ml-2 inline-block w-24" value={games} onChange={(e) => setGames(Number(e.target.value))}>
            {[5, 10, 20, 40].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <button className="btn btn-chalk" onClick={run} disabled={busy}>{busy ? "Playing" : "Run arena"}</button>
      </div>
      {error && <p className="mt-2 text-sm text-deck-red-soft">{error}</p>}
      {result && (
        <dl className="mt-4 grid max-w-xl grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-3">
          <div><dt className="text-chalk-faint">Bot wins</dt><dd className="display text-chalk" style={{ fontSize: 28 }}>{result.botWins} / {result.games}</dd></div>
          <div><dt className="text-chalk-faint">Bids made</dt><dd className="display text-chalk" style={{ fontSize: 28 }}>{Math.round(result.avgBidMade * 100)}%</dd></div>
          <div><dt className="text-chalk-faint">Per decision</dt><dd className="display text-chalk" style={{ fontSize: 28 }}>{result.avgDecisionMs.toFixed(1)} ms</dd></div>
        </dl>
      )}
    </section>
  );
}
