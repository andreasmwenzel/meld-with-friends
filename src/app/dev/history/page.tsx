import { Suspense } from "react";
import { notFound } from "next/navigation";
import { LobbyFrame } from "@/components/lobby/Lobby";
import { HistoryList, type HistoryEntry } from "@/components/lobby/History";
import { PastGames } from "@/components/lobby/PastGames";

const SAMPLE_HISTORY: HistoryEntry[] = [
  { gameId: "g1", code: "KQJ9TA", finishedAt: "2026-10-26T21:40:00Z", score: { red: 152, blue: 118 }, myTeam: "red", won: true, hands: 7, partner: "June", opponents: ["Margaret", "Theo"] },
  { gameId: "g2", code: "BRDGPX", finishedAt: "2026-10-24T19:05:00Z", score: { red: 96, blue: 150 }, myTeam: "red", won: false, hands: 9, partner: "Otto", opponents: ["Lee", "Sam"] },
  { gameId: "g3", code: "MNPQRS", finishedAt: "2026-10-19T02:15:00Z", score: { red: 1210, blue: 1520 }, myTeam: "blue", won: true, hands: 23, partner: "Bartholomew Featherstonehaugh", opponents: ["Maximiliana Oyelaran-Whitfield", "Jo"] },
  { gameId: "g4", code: "WXYZBC", finishedAt: "2026-10-02T23:59:00Z", score: { red: 151, blue: -40 }, myTeam: "blue", won: false, hands: 1, partner: "Grace", opponents: ["Ruth", "Mabel"] },
  { gameId: "g5", code: "HJKLMN", finishedAt: "2025-12-31T22:30:00Z", score: { red: 150, blue: 149 }, myTeam: "red", won: true, hands: 12, partner: "Sam", opponents: ["Lee", "Theo"] },
];

/**
 * Local-only preview of /history with sample games: won, lost, long names, one hand and many.
 * `?rows=N` shows the first N (`?rows=0` is the empty list).
 */
export default function DevHistoryPage({ searchParams }: PageProps<"/dev/history">) {
  if (process.env.NODE_ENV === "production") notFound();
  return <LobbyFrame><PastGames><Suspense><Preview searchParams={searchParams} /></Suspense></PastGames></LobbyFrame>;
}

async function Preview({ searchParams }: { searchParams: PageProps<"/dev/history">["searchParams"] }) {
  const sp = await searchParams;
  const count = sp.rows === undefined ? SAMPLE_HISTORY.length : Number(sp.rows);
  return <HistoryList rows={SAMPLE_HISTORY.slice(0, count)} />;
}
