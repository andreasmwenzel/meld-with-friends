// The replay as a browser walks it: positions, one move per row, and hands as chapters.
import { cardsOfStep, describeStep, expandReplay, handOutcome, type Replay } from "@/engine/replay";
import type { Action, CardId, GameState, HandRecord, SeatIndex, Trick } from "@/engine/types";

export type MoveKind = "deal" | "bid" | "trump" | "pass" | "meld" | "play" | "claim";

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
  bid: "bid", pass_bid: "bid", shoot: "bid", decline_shoot: "bid", misdeal: "bid", declare_trump: "trump", pass_cards: "pass",
  declare_meld: "meld", confirm_meld: "meld", play_card: "play", claim: "claim", next_hand: "deal",
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
    // The pass or misdeal that throws a hand in belongs to the hand it ended, though the board already shows the redeal.
    const thrownIn = step.action.type === "misdeal" || (step.action.type === "pass_bid" && after.handNumber !== before.handNumber);
    const hand = thrownIn ? before.handNumber : after.handNumber;
    moves.push({
      frame: i + 1, hand, kind: KIND[step.action.type], actor: step.action.seat,
      label: describeStep(step.action, before, after, nameOf), cards: cardsOfStep(step.action, after),
      trick: completedTrick ? lastTrickOf(after) : null, record,
    });
  });
  // Melding is one moment at the table, not four: the run of lay-downs and confirms becomes one move.
  for (let i = 0; i < moves.length; i++) {
    if (moves[i].kind !== "meld") continue;
    let j = i;
    while (j + 1 < moves.length && moves[j + 1].kind === "meld") j++;
    const last = moves[j], after = frames[last.frame];
    const order = [1, 2, 3, 4].map(n => ((after.dealer + n) % 4) as SeatIndex);
    const parts = order.map(seat => `${nameOf(seat)} ${after.players[seat].meldPoints}`);
    const label = `Meld: ${parts.join(", ")}${after.phase === "playing" && after.turn !== null ? `. ${nameOf(after.turn)} leads` : ""}`;
    moves.splice(i, j - i + 1, {
      frame: last.frame, hand: last.hand, kind: "meld", actor: null, label, trick: null, record: null,
      cards: [...new Set(after.players.flatMap(p => p.meld.flatMap(item => item.cards)))],
    });
  }
  const chapters: Chapter[] = [];
  moves.forEach((move, i) => {
    const current = chapters[chapters.length - 1];
    if (current && current.hand === move.hand) { current.last = i; return; }
    chapters.push({ hand: move.hand, first: i, last: i, record: null, title: "" });
  });
  for (const chapter of chapters) {
    const end = frames[moves[chapter.last].frame];
    chapter.record = end.history.find(h => h.handNumber === chapter.hand) ?? null;
    const ending = replay.steps[moves[chapter.last].frame - 1]?.action;
    chapter.title = chapter.record ? handOutcome(chapter.record, nameOf)
      : ending?.type === "misdeal" ? `${nameOf(ending.seat)} threw the hand in for nines` : "Everyone passed and the cards were redealt";
  }
  return { frames, moves, chapters };
}

/** The move at or before a frame index, for links that name a position. */
export function moveAtFrame(moves: Move[], frame: number): number {
  let found = 0;
  moves.forEach((move, i) => { if (move.frame <= frame) found = i; });
  return found;
}
