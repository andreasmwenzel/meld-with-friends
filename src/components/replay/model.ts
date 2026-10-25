// The replay as a browser walks it: positions, one move per row, and hands as chapters.
import { cardsOfStep, describeStep, expandReplay, handOutcome, type Replay } from "@/engine/replay";
import type { Action, CardId, GameState, HandRecord, SeatIndex, Trick } from "@/engine/types";

export type MoveKind = "deal" | "bid" | "trump" | "pass" | "meld" | "play";

export interface Move {
  /** index into `frames` of the position after this move */
  frame: number;
  /** the hand this position belongs to */
  hand: number;
  kind: MoveKind;
  label: string;
  /** the seat that acted; null for the opening deal */
  actor: SeatIndex | null;
  /** cards the move touched, lit on the board */
  cards: CardId[];
  /** the trick just completed, when this move finished one */
  trick: Trick | null;
  /** present on the move that ended the hand */
  record: HandRecord | null;
}

export interface Chapter {
  hand: number;
  /** index into `moves` of the chapter's first row */
  first: number;
  last: number;
  /** how the hand ended; null when the deal was thrown in */
  record: HandRecord | null;
  title: string;
}

export interface Walk { frames: GameState[]; moves: Move[]; chapters: Chapter[] }

const KIND: Record<Action["type"], MoveKind> = {
  bid: "bid", pass_bid: "bid", shoot: "bid", declare_trump: "trump", pass_cards: "pass",
  declare_meld: "meld", confirm_meld: "meld", play_card: "play", next_hand: "deal",
};
const lastTrickOf = (state: GameState) => (state as GameState & { lastTrick?: Trick | null }).lastTrick ?? null;

export function walk(replay: Replay, nameOf: (seat: SeatIndex) => string): Walk {
  const frames = expandReplay(replay);
  const moves: Move[] = [{
    frame: 0, hand: frames[0].handNumber, kind: "deal", actor: null, cards: [], trick: null, record: null,
    label: `Hand ${frames[0].handNumber}: ${nameOf(frames[0].dealer)} deals`,
  }];
  replay.steps.forEach((step, i) => {
    const next = replay.steps[i + 1]?.action;
    // A player's "lay down" and "confirm" read as one move when nothing happened between them.
    if (step.action.type === "declare_meld" && next?.type === "confirm_meld" && next.seat === step.action.seat) return;
    const before = frames[i], after = frames[i + 1];
    const completedTrick = step.action.type === "play_card" && before.currentTrick?.plays.length === 3;
    const record = after.history.length > before.history.length ? after.history[after.history.length - 1] : null;
    moves.push({
      frame: i + 1, hand: after.handNumber, kind: KIND[step.action.type], actor: step.action.seat,
      label: describeStep(step.action, before, after, nameOf), cards: cardsOfStep(step.action, after),
      trick: completedTrick ? lastTrickOf(after) : null, record,
    });
  });
  const chapters: Chapter[] = [];
  moves.forEach((move, i) => {
    const current = chapters[chapters.length - 1];
    if (current && current.hand === move.hand) { current.last = i; return; }
    chapters.push({ hand: move.hand, first: i, last: i, record: null, title: "" });
  });
  for (const chapter of chapters) {
    const end = frames[moves[chapter.last].frame];
    chapter.record = end.history.find(h => h.handNumber === chapter.hand) ?? null;
    chapter.title = chapter.record ? handOutcome(chapter.record, nameOf) : "Everyone passed and the cards were redealt";
  }
  return { frames, moves, chapters };
}

/** The move at or before a frame index, for links that name a position. */
export function moveAtFrame(moves: Move[], frame: number): number {
  let found = 0;
  moves.forEach((move, i) => { if (move.frame <= frame) found = i; });
  return found;
}
