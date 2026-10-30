"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";

/** One finished game as `/api/history` returns it. */
export interface HistoryEntry {
  gameId: string; code: string; finishedAt: string; score: { red: number; blue: number };
  myTeam: "red" | "blue"; won: boolean; abandoned: boolean; hands: number; partner: string; opponents: [string, string];
}

const fmt = new Intl.NumberFormat("en-US");
const dayFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

/** "Oct 26" this year, "Dec 31, 2025" before it. */
function finished(iso: string) {
  const d = new Date(iso);
  return (d.getFullYear() === new Date().getFullYear() ? dayFmt : dateFmt).format(d);
}

/** Finished games, newest first, fetched for the signed-in player. */
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

  if (error) return <p className="mt-3 max-w-md text-sm text-deck-red-soft">Could not load your past games. {error}</p>;
  if (rows === null) return <p className="mt-3 text-chalk-faint">Looking through the score sheets.</p>;
  return <HistoryList rows={rows} />;
}

/** Finished games as a dense divided list. The whole row opens the game's replay. */
export function HistoryList({ rows }: { rows: HistoryEntry[] }) {
  if (rows.length === 0) return <p className="mt-3 max-w-md text-chalk-faint">No finished games yet. Finish one and it shows up here, ready to replay.</p>;
  const won = rows.filter((g) => !g.abandoned && g.won).length;
  const unfinished = rows.filter((g) => g.abandoned).length;
  return (
    <>
      <p className="mt-2 text-sm text-chalk-faint">{won} won, {rows.length - won - unfinished} lost{unfinished > 0 ? `, ${unfinished} unfinished` : ""}. Tap a game to replay it.</p>
      <ul className="mt-3 flex flex-col divide-y divide-chalk-ghost">
        {rows.map((g) => {
          const mine = g.score[g.myTeam];
          const theirs = g.score[g.myTeam === "red" ? "blue" : "red"];
          const full = `With ${g.partner} vs ${g.opponents[0]} and ${g.opponents[1]}`;
          return (
            <li key={g.gameId}>
              <Link href={`/replay/${g.gameId}`} className="group flex min-h-11 items-center gap-4 py-2.5 no-underline">
                <div className="min-w-0 flex-1">
                  <p className="leading-snug">
                    <span className="sr-only">Replay: </span>
                    <span className={!g.abandoned && g.won ? "font-semibold text-brass" : "text-chalk-faint"}>{g.abandoned ? "Unfinished" : g.won ? "Won" : "Lost"}</span>{" "}
                    <span className="tabular-nums text-chalk">{fmt.format(mine)} to {fmt.format(theirs)}</span>
                    <span className="text-chalk-faint"> in {g.abandoned && g.hands === 0 ? "hand 1" : `${g.hands} ${g.hands === 1 ? "hand" : "hands"}`}</span>
                  </p>
                  {/* Screen readers get the full names; the visible line keeps first names and may truncate. */}
                  <p className="mt-0.5 truncate text-sm text-chalk-faint" title={full}>
                    <span aria-hidden>With {firstName(g.partner)} vs {firstName(g.opponents[0])} and {firstName(g.opponents[1])}</span>
                    <span className="sr-only">{full}</span>
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="code text-chalk group-hover:text-brass" style={{ fontSize: 15, letterSpacing: ".08em" }}>{g.code}</p>
                  <p className="mt-1 text-sm text-chalk-faint"><time dateTime={g.finishedAt}>{finished(g.finishedAt)}</time></p>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
