// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HeartsBoard, type LocalHearts } from "../HeartsBoard";
import { applyHeartsAction, chooseHeartsAction, heartsViewFor, newHeartsGame } from "@/engine/hearts";
import type { HeartsAction, HeartsState, SeatIndex } from "@/engine/hearts/types";
import type { Snapshot } from "@/components/table/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));

const ME = { id: "u0", handle: "andreas", display_name: "Andreas", avatar_seed: "0" };
const snap: Snapshot = {
  table: { id: "t", code: "HRTSQN", host: ME.id, game_kind: "hearts", status: "playing", rules: {}, current_game_id: "g" },
  seats: [
    { seat: 0, user_id: ME.id, bot: null, profile: ME },
    { seat: 1, user_id: null, bot: "Priya", profile: null },
    { seat: 2, user_id: null, bot: "Walt", profile: null },
    { seat: 3, user_id: null, bot: "Nell", profile: null },
  ],
  offers: [], mySeat: 0, ready: [], paused: null,
};

/** A driver round an engine state; the bots never move on their own. */
function driver(start: HeartsState) {
  const box = { s: start };
  const sent: HeartsAction[] = [];
  const local: LocalHearts = {
    fetchView: async () => ({ ...heartsViewFor(box.s, 0), ready: [] }),
    act: async (action) => { sent.push(action); box.s = applyHeartsAction(box.s, action); return { ...heartsViewFor(box.s, 0), ready: [] }; },
    tick: async () => {},
  };
  return { local, sent, box };
}

beforeEach(() => {
  // A phone-sized board with a fine pointer, so one tap plays a card.
  window.matchMedia = ((query: string) => ({ matches: query.includes("max-width"), media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as unknown as typeof window.matchMedia;
});
afterEach(cleanup);

describe("HeartsBoard", () => {
  it("passes three chosen cards", async () => {
    let s = newHeartsGame("board-test", {}, 3);
    for (const seat of [1, 2, 3] as SeatIndex[]) s = applyHeartsAction(s, chooseHeartsAction(heartsViewFor(s, seat), "x"));
    const { local, sent, box } = driver(s);
    render(<HeartsBoard code="HRTSQN" me={ME} snap={snap} onTableChange={() => {}} local={local} />);
    const pass = await screen.findByRole("button", { name: "Pass three cards" });
    expect((pass as HTMLButtonElement).disabled).toBe(true);
    const cards = screen.getAllByRole("button", { name: /of (clubs|diamonds|spades|hearts)/ });
    expect(cards).toHaveLength(13);
    for (const card of cards.slice(0, 3)) fireEvent.click(card);
    expect((pass as HTMLButtonElement).disabled).toBe(false);
    await act(async () => { fireEvent.click(pass); });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: "pass_cards", seat: 0 });
    expect(sent[0].type === "pass_cards" && sent[0].cards).toHaveLength(3);
    await waitFor(() => expect(box.s.phase).toBe("playing"));
  });

  it("plays only a legal card on your turn", async () => {
    let s = newHeartsGame("board-test", { passing: "none" }, 3);
    // Play bots until it is South's turn.
    for (let i = 0; i < 20 && s.turn !== 0; i++) s = applyHeartsAction(s, chooseHeartsAction(heartsViewFor(s, s.turn!), `x${i}`));
    expect(s.turn).toBe(0);
    const legal = heartsViewFor(s, 0).legal.playableCards;
    const { local, sent } = driver(s);
    render(<HeartsBoard code="HRTSQN" me={ME} snap={snap} onTableChange={() => {}} local={local} />);
    await screen.findByText(/Your turn/);
    const cards = screen.getAllByRole("button", { name: /of (clubs|diamonds|spades|hearts)/ });
    const enabled = cards.filter((c) => !(c as HTMLButtonElement).disabled);
    expect(enabled).toHaveLength(legal.length);
    await act(async () => { fireEvent.click(enabled[0]); });
    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe("play_card");
    expect(legal).toContain((sent[0] as { card: string }).card);
  });
});
