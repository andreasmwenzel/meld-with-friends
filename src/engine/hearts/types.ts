// Hearts engine types. Pure data, serialisable to JSON (stored in games.state, keyed by game_kind = 'hearts').
// Deterministic given (state, action, seed). No I/O here. The pinochle engine lives beside this in src/engine;
// the two share only Suit and SeatIndex.

import type { SeatIndex, Suit } from "../types";
export type { SeatIndex, Suit };

/** A standard 52-card deck: one copy of each card, so the id is just rank + suit, e.g. "2C", "TS", "QS", "AH". */
export type StdRank = "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "T" | "J" | "Q" | "K" | "A";
export type HeartsCardId = `${StdRank}${Suit}`;

export type HeartsPhase = "passing" | "playing" | "hand_over" | "game_over";
/** Who the cards go to this hand: left, right, across, then a hold (no pass), repeating from the first hand. */
export type PassDirection = "left" | "right" | "across" | "hold";

export interface HeartsRules {
  /** live tables expect everyone at the table now; leisurely ones play over days (push nudges, away handling) */
  pace: "live" | "leisurely";
  /** the game ends after the hand in which someone reaches this many points; lowest score wins (default 100) */
  target: number;
  /** "rotate": left, right, across, hold. "none": every hand is played as dealt. */
  passing: "rotate" | "none";
  /** shooting the moon: "add" puts 26 on everyone else, "subtract" takes 26 off the shooter (default add) */
  moon: "add" | "subtract";
  /** the jack of diamonds is worth −10 to whoever takes it (default off) */
  jackOfDiamonds: boolean;
  /** no hearts or the queen of spades on the first trick unless the player holds nothing else (default on) */
  noPointsFirstTrick: boolean;
}

export const DEFAULT_HEARTS_RULES: HeartsRules = {
  pace: "live", target: 100, passing: "rotate", moon: "add", jackOfDiamonds: false, noPointsFirstTrick: true,
};

export interface HeartsPlay { seat: SeatIndex; card: HeartsCardId }
export interface HeartsTrick { leader: SeatIndex; plays: HeartsPlay[]; winner: SeatIndex | null }

export interface HeartsPlayer {
  seat: SeatIndex;
  hand: HeartsCardId[];
  /** cards chosen while passing; cleared once everyone has passed and the cards move */
  passBuffer: HeartsCardId[];
  passed: boolean;
  /** cards this seat has taken in tricks this hand */
  taken: HeartsCardId[];
}

/** What a seat is holding against it this hand, from the cards it has taken. Public: everyone sees every trick. */
export interface Penalties {
  hearts: number;
  queen: boolean;
  /** the jack of diamonds, only ever true when rules.jackOfDiamonds is on */
  jack: boolean;
  /** hearts + 13 for the queen − 10 for the jack: the points this seat is sitting on before any moon */
  points: number;
}

export interface HeartsHandRecord {
  handNumber: number;
  dealer: SeatIndex;
  pass: PassDirection;
  /** points each seat took in tricks (hearts and the queen, less the jack) */
  taken: Record<SeatIndex, number>;
  /** the change applied to each seat's score once a moon is accounted for */
  delta: Record<SeatIndex, number>;
  /** the seat that took every heart and the queen, if any */
  moon: SeatIndex | null;
}

export interface HeartsState {
  version: 1;
  kind: "hearts";
  rules: HeartsRules;
  phase: HeartsPhase;
  handNumber: number;
  dealer: SeatIndex;
  /** whose play is awaited; null while passing (everyone at once) and when the hand or game is over */
  turn: SeatIndex | null;
  players: [HeartsPlayer, HeartsPlayer, HeartsPlayer, HeartsPlayer];
  pass: PassDirection;
  /** what each seat received in the pass this hand, so the view can show it until the first card is played */
  received: Record<SeatIndex, HeartsCardId[]>;
  currentTrick: HeartsTrick | null;
  lastTrick: HeartsTrick | null;
  /** completed tricks this hand, in order */
  tricks: HeartsTrick[];
  heartsBroken: boolean;
  score: Record<SeatIndex, number>;
  history: HeartsHandRecord[];
  /** the lowest score once someone reaches the target; null until then (a tie for lowest keeps playing) */
  winner: SeatIndex | null;
  seed: string;
  rev: number;
  log: string[];
}

export type HeartsAction =
  | { type: "pass_cards"; seat: SeatIndex; cards: HeartsCardId[] }
  | { type: "play_card"; seat: SeatIndex; card: HeartsCardId }
  | { type: "next_hand"; seat: SeatIndex };

export type HeartsPlayReason =
  | "lead_two_clubs" // the two of clubs opens every hand
  | "follow_suit"
  | "hearts_not_broken" // on lead, hearts may not be led until one has been discarded (or only hearts remain)
  | "no_points_first_trick"
  | "lead_any"
  | "any";

export interface HeartsLegal {
  /** the number of cards to choose while passing (3), or null */
  mustPassCount: number | null;
  /** cards that may be played right now; empty when it is not your turn */
  playableCards: HeartsCardId[];
  /** why the playable set is what it is, for the prompt line; null when not your turn */
  playReason: HeartsPlayReason | null;
  canAdvanceHand: boolean;
}

/** One seat's view. Other hands are hidden; everything taken is public. */
export interface HeartsView {
  kind: "hearts";
  seat: SeatIndex;
  phase: HeartsPhase;
  handNumber: number;
  dealer: SeatIndex;
  turn: SeatIndex | null;
  rules: HeartsRules;
  hand: HeartsCardId[];
  handCounts: [number, number, number, number];
  pass: PassDirection;
  /** whether each seat has chosen their pass; all true the moment play begins */
  passed: Record<SeatIndex, boolean>;
  /** the three cards you were handed this hand, until you play your first card; empty on a hold */
  received: HeartsCardId[];
  currentTrick: HeartsTrick | null;
  lastTrick: HeartsTrick | null;
  heartsBroken: boolean;
  /** every card played this hand so far, in play order */
  playedCards: HeartsPlay[];
  taken: Record<SeatIndex, Penalties>;
  tricksTaken: Record<SeatIndex, number>;
  score: Record<SeatIndex, number>;
  history: HeartsHandRecord[];
  winner: SeatIndex | null;
  rev: number;
  log: string[];
  legal: HeartsLegal;
}
