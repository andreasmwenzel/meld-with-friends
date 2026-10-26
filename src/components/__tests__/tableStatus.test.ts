import { describe, expect, it } from "vitest";
import { sortTables, summarizeTable, type TableFacts } from "@/lib/tableStatus";
import type { SeatIndex } from "@/engine/types";

const ME = "me";
function facts(over: Partial<TableFacts> = {}, game: Partial<NonNullable<TableFacts["game"]>> | null = {}): TableFacts {
  return {
    code: "BCDFGH", status: "playing", host: ME, pausedBy: null, createdAt: "2026-10-01T00:00:00Z",
    seats: [
      { seat: 0, userId: ME, bot: null, name: "Andreas Wenzel" },
      { seat: 1, userId: "lee", bot: null, name: "Lee" },
      { seat: 2, userId: null, bot: "Mabel", name: "Mabel" },
      { seat: 3, userId: "jo", bot: null, name: "Jo Park" },
    ],
    game: game && {
      rev: 10, updatedAt: "2026-10-02T00:00:00Z", phase: "bidding", turn: 0, winner: null,
      score: { red: 82, blue: 64 }, meldConfirmed: [false, false, false, false], ready: [], ...game,
    },
    lastSeenRev: 10,
    ...over,
  };
}

describe("summarizeTable", () => {
  it("says when it is your turn and scores from your side", () => {
    const s = summarizeTable(facts({}, { turn: 0 }), ME)!;
    expect(s.line).toBe("Your turn to bid");
    expect(s.yours).toBe(true);
    expect(s.score).toEqual({ us: 82, them: 64 });
    expect(s.chairs.find((c) => c.seat === 0)).toMatchObject({ me: true, up: true });
  });

  it("names who the table is waiting on", () => {
    const s = summarizeTable(facts({}, { phase: "playing", turn: 3 as SeatIndex }), ME)!;
    expect(s.line).toBe("Waiting on Jo to play");
    expect(s.yours).toBe(false);
    expect(s.chairs[3].up).toBe(true);
  });

  it("scores for the blue team when you sit there", () => {
    const f = facts();
    f.seats[0].userId = "lee"; f.seats[1].userId = ME;
    expect(summarizeTable(f, ME)!.score).toEqual({ us: 64, them: 82 });
  });

  it("lists everyone still to meld", () => {
    const s = summarizeTable(facts({}, { phase: "melding", turn: null, meldConfirmed: [true, false, true, false] }), ME)!;
    expect(s.line).toBe("Waiting on Lee and Jo to meld");
    expect(s.yours).toBe(false);
  });

  it("asks you to ready up after a hand", () => {
    const s = summarizeTable(facts({ host: "lee" }, { phase: "hand_over", turn: null, ready: [3] }), ME)!;
    expect(s.line).toBe("Hand over. Ready up for the next deal");
    expect(s.yours).toBe(true);
  });

  it("counts the host as ready and offers the deal once nobody is pending", () => {
    expect(summarizeTable(facts({}, { phase: "hand_over", turn: null, ready: [] }), ME)!.line).toBe("Waiting on Lee and Jo to ready up");
    const s = summarizeTable(facts({}, { phase: "hand_over", turn: null, ready: [1, 3] }), ME)!;
    expect(s.line).toBe("Hand over. Deal the next hand");
    expect(s.yours).toBe(true);
    expect(s.chairs.some((c) => c.up)).toBe(false);
  });

  it("counts chairs at an open table and prompts the host to start", () => {
    const open = facts({ status: "open" }, null);
    expect(summarizeTable(open, ME)!.line).toBe("Everyone is seated. Start the game");
    open.seats[1] = { seat: 1, userId: null, bot: null, name: null };
    expect(summarizeTable(open, ME)!.line).toBe("3 of 4 chairs filled");
  });

  it("marks fresh moves and pauses", () => {
    expect(summarizeTable(facts({ lastSeenRev: 4 }), ME)!.fresh).toBe(true);
    expect(summarizeTable(facts({ lastSeenRev: null }), ME)!.fresh).toBe(false);
    expect(summarizeTable(facts({ pausedBy: "lee" }), ME)!.line).toBe("Paused by Lee");
  });

  it("reports the result at game over", () => {
    expect(summarizeTable(facts({}, { phase: "game_over", turn: null, winner: "red" }), ME)!.line).toBe("Game over. You won");
  });

  it("skips tables you are not seated at or that are finished", () => {
    expect(summarizeTable(facts(), "stranger")).toBeNull();
    expect(summarizeTable(facts({ status: "finished" }), ME)).toBeNull();
  });
});

it("puts tables waiting on you first, then the most recent", () => {
  const a = summarizeTable(facts({ code: "AAAAAA" }, { turn: 1, updatedAt: "2026-10-05T00:00:00Z" }), ME)!;
  const b = summarizeTable(facts({ code: "BBBBBB" }, { turn: 0, updatedAt: "2026-10-01T00:00:00Z" }), ME)!;
  const c = summarizeTable(facts({ code: "CCCCCC" }, { turn: 1, updatedAt: "2026-10-09T00:00:00Z" }), ME)!;
  expect(sortTables([a, b, c]).map((t) => t.code)).toEqual(["BBBBBB", "CCCCCC", "AAAAAA"]);
});
