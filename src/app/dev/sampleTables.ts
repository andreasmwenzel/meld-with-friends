import type { SeatIndex } from "@/engine/types";
import type { TableFacts } from "@/lib/tableStatus";

/** The signed-in player in the sample tables. */
export const ME = "u0";

const seats = (names: (string | null)[], bots: number[] = []): TableFacts["seats"] =>
  names.map((name, seat) => ({ seat: seat as SeatIndex, userId: name && !bots.includes(seat) ? (seat === 0 ? ME : `u${seat}`) : null, bot: bots.includes(seat) ? name : null, name }));
const game = (over: Partial<NonNullable<TableFacts["game"]>>): TableFacts["game"] => ({
  rev: 40, updatedAt: "2026-10-25T20:00:00Z", phase: "playing", turn: 0, winner: null, score: { red: 0, blue: 0 },
  meldConfirmed: [false, false, false, false], ready: [], ...over,
});

/** Unfinished tables in several states, for the dev previews of the front door and the lobby. */
export const SAMPLE_TABLES: TableFacts[] = [
  { code: "KQJ9TA", status: "playing", host: ME, pausedBy: null, createdAt: "2026-10-24T00:00:00Z", lastSeenRev: 36,
    seats: seats(["Andreas", "Margaret", "June", "Theo"]), game: game({ phase: "bidding", turn: 0, score: { red: 82, blue: 64 } }) },
  { code: "BRDGPX", status: "playing", host: "u1", pausedBy: null, createdAt: "2026-10-23T00:00:00Z", lastSeenRev: 40,
    seats: seats(["Andreas", "Lee", "Otto", "Sam"], [2]), game: game({ phase: "playing", turn: 3, score: { red: 121, blue: 133 }, updatedAt: "2026-10-25T19:00:00Z" }) },
  { code: "MNPQRS", status: "playing", host: ME, pausedBy: null, createdAt: "2026-10-22T00:00:00Z", lastSeenRev: 12,
    seats: seats(["Andreas", "Jo Park", "Mabel", "Ruth"], [2]), game: game({ phase: "melding", turn: null, meldConfirmed: [true, false, true, false], score: { red: 30, blue: 41 }, updatedAt: "2026-10-25T18:00:00Z" }) },
  { code: "WXYZBC", status: "open", host: ME, pausedBy: null, createdAt: "2026-10-25T21:00:00Z", lastSeenRev: null,
    seats: seats(["Andreas", null, "Grace", null]), game: null },
];
