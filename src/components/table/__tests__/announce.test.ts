import { describe, expect, it } from "vitest";
import type { SeatIndex } from "@/engine/types";
import { newLogLines, speakLine } from "../announce";

const names = ["You", "Margaret", "Walt", "June"];
const nameOf = (s: SeatIndex) => names[s];

describe("announcements", () => {
  it("finds lines added since the last view, even when the capped log drops old ones", () => {
    expect(newLogLines(["a", "b"], ["a", "b", "c", "d"])).toEqual(["c", "d"]);
    expect(newLogLines(["a", "b", "c"], ["b", "c", "d"])).toEqual(["d"]);
    expect(newLogLines(["x", "pass", "pass"], ["x", "pass", "pass", "pass"])).toEqual(["pass"]);
    expect(newLogLines(["a"], ["a"])).toEqual([]);
  });

  it("speaks cards as words and seats as the names at the table", () => {
    expect(speakLine("West plays 10♥", nameOf)).toBe("Margaret plays ten of hearts");
    expect(speakLine("South plays A♠", nameOf)).toBe("You play ace of spades");
    expect(speakLine("South takes the trick", nameOf)).toBe("You take the trick");
    expect(speakLine("North passes 4 cards to South", nameOf)).toBe("Walt passes 4 cards to you");
    expect(speakLine("East wins the bid at 260", nameOf)).toBe("June wins the bid at 260");
    expect(speakLine("Red makes 300; hand over", nameOf)).toBe("Red makes 300; hand over");
  });
});
