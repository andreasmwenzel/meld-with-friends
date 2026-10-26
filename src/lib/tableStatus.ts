import type { Phase, SeatIndex, Team } from "@/engine/types";

/** What the lobby knows about one of the player's tables, read on the server. */
export interface TableFacts {
  code: string;
  status: "open" | "playing" | "finished";
  host: string;
  pausedBy: string | null;
  createdAt: string;
  seats: { seat: SeatIndex; userId: string | null; bot: string | null; name: string | null }[];
  game: {
    rev: number; updatedAt: string; phase: Phase; turn: SeatIndex | null; winner: Team | null;
    score: Record<Team, number> | null; meldConfirmed: boolean[]; ready: SeatIndex[];
  } | null;
  lastSeenRev: number | null;
}

export interface TableChair { seat: SeatIndex; name: string | null; me: boolean; bot: boolean; up: boolean }

/** One row of "Your tables": who sits where, whose move it is, and the score from your side. */
export interface TableSummary {
  code: string;
  mySeat: SeatIndex;
  chairs: TableChair[];
  /** one sentence: "Your turn to bid", "Waiting on Lee to play", "3 of 4 chairs filled" */
  line: string;
  /** the table is waiting on you */
  yours: boolean;
  /** moves were made since you last looked */
  fresh: boolean;
  score: { us: number; them: number } | null;
  activity: string;
}

const teamOf = (seat: SeatIndex): Team => seat % 2 === 0 ? "red" : "blue";
const firstName = (name: string | null) => name?.trim().split(/\s+/)[0] || "someone";

const MY_MOVE: Partial<Record<Phase, string>> = {
  dealing: "Dealing",
  bidding: "Your turn to bid",
  declaring_trump: "Your turn to name trump",
  passing_to_bidder: "Your turn to pass cards",
  passing_back: "Your turn to pass cards back",
  playing: "Your turn to play",
};
const THEIR_MOVE: Partial<Record<Phase, string>> = {
  bidding: "to bid",
  declaring_trump: "to name trump",
  passing_to_bidder: "to pass cards",
  passing_back: "to pass cards back",
  playing: "to play",
};

function names(list: string[]) {
  if (list.length <= 1) return list[0] ?? "";
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

export function summarizeTable(t: TableFacts, userId: string): TableSummary | null {
  const mine = t.seats.find((s) => s.userId === userId);
  if (!mine || t.status === "finished") return null;
  const g = t.game;
  const up = new Set<SeatIndex>();
  let line: string;
  let yours = false;

  const nameAt = (seat: SeatIndex) => firstName(t.seats.find((s) => s.seat === seat)?.name ?? null);

  if (t.pausedBy) {
    const by = t.seats.find((s) => s.userId === t.pausedBy);
    line = by?.userId === userId ? "You paused the game" : `Paused by ${firstName(by?.name ?? null)}`;
  } else if (t.status === "open" || !g) {
    const seated = t.seats.filter((s) => s.userId || s.bot).length;
    if (seated < 4) line = `${seated} of 4 chairs filled`;
    else if (t.host === userId) { line = "Everyone is seated. Start the game"; yours = true; }
    else line = "Waiting for the host to start";
  } else if (g.phase === "game_over") {
    const won = g.winner === teamOf(mine.seat);
    line = g.winner ? (won ? "Game over. You won" : "Game over. You lost") : "Game over";
  } else if (g.phase === "hand_over") {
    // The host counts as ready, as at the table; once nobody is pending, anyone may deal.
    const waiting = t.seats.filter((s) => s.userId && s.userId !== t.host && !g.ready.includes(s.seat));
    waiting.forEach((s) => up.add(s.seat));
    if (waiting.some((s) => s.seat === mine.seat)) { line = "Hand over. Ready up for the next deal"; yours = true; }
    else if (waiting.length) line = `Waiting on ${names(waiting.map((s) => firstName(s.name)))} to ready up`;
    else { line = "Hand over. Deal the next hand"; yours = true; }
  } else if (g.phase === "melding") {
    const waiting = t.seats.filter((s) => !g.meldConfirmed[s.seat]);
    waiting.forEach((s) => up.add(s.seat));
    if (waiting.some((s) => s.seat === mine.seat)) { line = "Your turn to lay meld"; yours = true; }
    else line = waiting.length ? `Waiting on ${names(waiting.map((s) => firstName(s.name)))} to meld` : "Meld is down";
  } else if (g.turn === null) {
    line = "Dealing";
  } else {
    up.add(g.turn);
    if (g.turn === mine.seat) { line = MY_MOVE[g.phase] ?? "Your turn"; yours = g.phase !== "dealing"; }
    else line = `Waiting on ${nameAt(g.turn)} ${THEIR_MOVE[g.phase] ?? ""}`.trim();
  }

  const myTeam = teamOf(mine.seat);
  const score = g?.score ? { us: g.score[myTeam], them: g.score[myTeam === "red" ? "blue" : "red"] } : null;
  return {
    code: t.code,
    mySeat: mine.seat,
    chairs: ([0, 1, 2, 3] as SeatIndex[]).map((seat) => {
      const s = t.seats.find((x) => x.seat === seat);
      return { seat, name: s?.name ?? s?.bot ?? null, me: seat === mine.seat, bot: !!s?.bot, up: up.has(seat) };
    }),
    line,
    yours,
    fresh: !!g && t.lastSeenRev !== null && g.rev > t.lastSeenRev,
    score,
    activity: g?.updatedAt ?? t.createdAt,
  };
}

/** Tables waiting on you first, then the most recently active. */
export function sortTables(list: TableSummary[]) {
  return [...list].sort((a, b) => Number(b.yours) - Number(a.yours) || b.activity.localeCompare(a.activity));
}
