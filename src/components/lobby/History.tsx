"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

interface HistoryEntry {
  gameId: string; code: string; finishedAt: string; score: { red: number; blue: number };
  myTeam: "red" | "blue"; won: boolean; hands: number; partner: string; opponents: [string, string];
}

const fmt = new Intl.NumberFormat("en-US");
const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

/** Finished games, newest first, as a plain divided list. */
export function History() {
  const [rows, setRows] = useState<HistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api<HistoryEntry[]>("/api/history")
      .then((r) => { if (live) setRows(r); })
      .catch((e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, []);

  return (
    <div>
      <h2 className="display mt-12" style={{ fontSize: 34 }}>Past games</h2>
      {error ? (
        <p className="mt-3 max-w-md text-sm text-deck-red-soft">Could not load your past games. {error}</p>
      ) : rows === null ? (
        <p className="mt-3 text-chalk-faint">Looking through the score sheets.</p>
      ) : rows.length === 0 ? (
        <p className="mt-3 max-w-md text-chalk-faint">No finished games yet. The first one goes here.</p>
      ) : (
        <ul className="mt-4 flex flex-col divide-y divide-chalk-ghost">
          {rows.map((g) => {
            const mine = g.score[g.myTeam];
            const theirs = g.score[g.myTeam === "red" ? "blue" : "red"];
            const hi = Math.max(mine, theirs), lo = Math.min(mine, theirs);
            return (
              <li key={g.gameId} className="flex items-start justify-between gap-4 py-4">
                <div className="min-w-0">
                  <p>
                    <span className={g.won ? "font-semibold text-chalk" : "text-chalk-faint"}>{g.won ? "Won" : "Lost"}</span>{" "}
                    {fmt.format(g.won ? hi : lo)} to {fmt.format(g.won ? lo : hi)} with {g.partner}
                  </p>
                  <p className="text-sm text-chalk-faint">
                    Against {g.opponents[0]} and {g.opponents[1]}, {g.hands} {g.hands === 1 ? "hand" : "hands"}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="code" style={{ fontSize: 18, letterSpacing: ".14em" }}>{g.code}</p>
                  <p className="text-sm text-chalk-faint">
                    <time dateTime={g.finishedAt}>{dateFmt.format(new Date(g.finishedAt))}</time>
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
