// Shared pinochle engine types. Pure data, serialisable to JSON (stored in Postgres jsonb).
// The engine is deterministic given (state, action, rng seed). No I/O here.

export type Suit = "S" | "H" | "D" | "C";
export type Rank = "A" | "T" | "K" | "Q" | "J" | "9"; // T = ten
/** A card id is rank+suit+copy, e.g. "AS0", "AS1" (48-card deck has two of each). */
export type CardId = `${Rank}${Suit}${0 | 1}`;

export type SeatIndex = 0 | 1 | 2 | 3; // clockwise. Seats 0 and 2 are team "red", 1 and 3 are team "blue".
export type Team = "red" | "blue";

export type Phase =
  | "dealing"
  | "bidding"
  | "declaring_trump"
  | "passing_to_bidder" // partner passes N cards to bidder
  | "passing_back" // bidder passes N cards back to partner
  | "melding" // each player chooses which cards to lay down as meld (any time before trick play starts)
  | "playing"
  | "hand_over"
  | "game_over";

export interface RulesConfig {
  pace: "live" | "leisurely";
  /** points needed to win (default 1500) */
  target: number;
  /** minimum opening bid (default 250) */
  minBid: number;
  /** bid increment (default 10) */
  bidStep: number;
  /** number of cards partner passes to bidder and bidder passes back (default 4; 0 disables passing) */
  passCount: number;
  /** points for the last trick (default 10) */
  lastTrickBonus: number;
  /** counters: value of A, T, K per trick taken (default 10 each; 9, Q, J count 0). Used when counting is "tens". */
  counterValue: number;
  /**
   * How tricks are counted. "tens": A, T, K are worth counterValue each (default).
   * "classic": A 11, T 10, K 4, Q 3, J 2, 9 0 — the old-style count, 240 in the deck plus the last trick.
   */
  counting: "tens" | "classic";
  /** if the declaring side fails to make its bid it loses the bid amount ("goes set") */
  setPenaltyIsBid: true;
  /** a side must take at least one trick to score its meld (default true) */
  mustTakeTrickToSaveMeld: boolean;
  /** when everyone passes, the dealer is forced to take the minimum bid (default true) */
  dealerStuck: boolean;
  /**
   * Shooting the moon: a bid to take all twelve tricks with your partner.
   * "off": not allowed. "game": make it and you win the game; miss and you lose the game.
   * "points": make it for +shootPoints, miss for -shootPoints.
   */
  shoot: "off" | "game" | "points";
  shootPoints: number;
  /** show everyone all four hands once the hand is over (default true) */
  revealHands: boolean;
}

export const DEFAULT_RULES: RulesConfig = {
  pace: "live",
  target: 1500,
  minBid: 250,
  bidStep: 10,
  passCount: 4,
  lastTrickBonus: 10,
  counterValue: 10,
  counting: "tens",
  setPenaltyIsBid: true,
  mustTakeTrickToSaveMeld: true,
  dealerStuck: true,
  shoot: "off",
  shootPoints: 1500,
  revealHands: true,
};

export type MeldKind =
  | "run" // A T K Q J of trump = 150
  | "double_run" // two runs = 1500
  | "royal_marriage" // K Q of trump = 40 (not counted if part of a run)
  | "marriage" // K Q same non-trump suit = 20
  | "dix" // 9 of trump = 10 each
  | "pinochle" // Q♠ J♦ = 40
  | "double_pinochle" // both Q♠ and both J♦ = 300
  | "aces_around" // one ace of each suit = 100
  | "kings_around" // 80
  | "queens_around" // 60
  | "jacks_around" // 40
  | "double_aces_around" // 1000
  | "double_kings_around" // 800
  | "double_queens_around" // 600
  | "double_jacks_around"; // 400

export interface MeldItem {
  kind: MeldKind;
  cards: CardId[];
  points: number;
}

export interface Bid {
  seat: SeatIndex;
  /** null means pass */
  amount: number | null;
  /** true when this bid is a shoot (take every trick); amount is then the game's shoot stake */
  shoot?: boolean;
}

export interface TrickPlay {
  seat: SeatIndex;
  card: CardId;
}

export interface Trick {
  leader: SeatIndex;
  plays: TrickPlay[];
  winner: SeatIndex | null;
}

export interface HandRecap {
  handNumber: number;
  dealer: SeatIndex;
  bids: { seat: SeatIndex; amount: number | null; shoot?: boolean }[];
  bidder: SeatIndex | null;
  bid: number | null;
  trump: Suit | null;
  passing: { done: boolean; count: number };
  myPassedOut: CardId[];
  myPassedIn: CardId[];
  melds: Record<SeatIndex, { items: MeldItem[]; points: number }>;
  tricks: { index: number; leader: SeatIndex; plays: TrickPlay[]; winner: SeatIndex; counters: number }[];
  current: Trick | null;
  trickCounts: Record<Team, number>;
  counters: Record<Team, number>;
}

export interface HandScoreBreakdown {
  meldDeclared: number;
  meldSaved: number;
  counters: number;
  lastTrick: number;
  setPenalty: number;
  shoot: number;
}

export type PlayReason = "lead_any" | "follow_suit" | "must_head" | "must_trump" | "must_overtrump" | "any";
export interface PlayConstraint {
  reason: PlayReason;
  ledSuit: Suit | null;
  mustBeat: CardId | null;
}

export interface HandRecord {
  handNumber: number;
  dealer: SeatIndex;
  bidder: SeatIndex;
  bid: number;
  trump: Suit;
  meld: Record<Team, number>;
  tricks: Record<Team, number>;
  /** final change applied to each team's score for this hand (negative when set) */
  delta: Record<Team, number>;
  breakdown: Record<Team, HandScoreBreakdown>;
  wentSet: boolean;
  /** present when the hand was a shoot; true if every trick was taken */
  shotMade?: boolean;
}

export interface PlayerState {
  seat: SeatIndex;
  hand: CardId[];
  /** cards this player has declared as meld this hand */
  meld: MeldItem[];
  meldPoints: number;
  meldConfirmed: boolean;
  /** cards chosen for passing while in a passing phase */
  passBuffer: CardId[];
}

export interface GameState {
  version: 1;
  rules: RulesConfig;
  phase: Phase;
  handNumber: number;
  dealer: SeatIndex;
  /** whose action is awaited; null when waiting on several (melding) */
  turn: SeatIndex | null;
  players: [PlayerState, PlayerState, PlayerState, PlayerState];
  bids: Bid[];
  highBid: Bid | null;
  bidder: SeatIndex | null;
  trump: Suit | null;
  currentTrick: Trick | null;
  tricksTaken: Record<Team, CardId[][]>;
  /** running game score */
  score: Record<Team, number>;
  history: HandRecord[];
  winner: Team | null;
  /** seeded rng state so replays are deterministic */
  seed: string;
  /** monotonically increasing; incremented by every applied action */
  rev: number;
  /** short human readable log, most recent last; capped at 50 */
  log: string[];
}

export type Action =
  | { type: "bid"; seat: SeatIndex; amount: number }
  | { type: "pass_bid"; seat: SeatIndex }
  | { type: "shoot"; seat: SeatIndex }
  | { type: "declare_trump"; seat: SeatIndex; suit: Suit }
  | { type: "pass_cards"; seat: SeatIndex; cards: CardId[] }
  | { type: "declare_meld"; seat: SeatIndex; cards: CardId[] } // cards laid down; engine computes best meld from them
  | { type: "confirm_meld"; seat: SeatIndex } // done melding (may be with zero cards)
  | { type: "play_card"; seat: SeatIndex; card: CardId }
  | { type: "next_hand"; seat: SeatIndex }; // any seat may advance after hand_over

/** What a single player is allowed to see. Other hands are hidden; only their counts are exposed. */
export interface PlayerView {
  recap: HandRecap;
  seat: SeatIndex;
  phase: Phase;
  handNumber: number;
  dealer: SeatIndex;
  turn: SeatIndex | null;
  rules: RulesConfig;
  hand: CardId[];
  handCounts: [number, number, number, number];
  /** every seat's declared meld is public once declared */
  melds: Record<SeatIndex, MeldItem[]>;
  meldConfirmed: Record<SeatIndex, boolean>;
  bids: Bid[];
  highBid: Bid | null;
  bidder: SeatIndex | null;
  trump: Suit | null;
  currentTrick: Trick | null;
  lastTrick: Trick | null;
  trickCounts: Record<Team, number>;
  /** every card played this hand so far, in play order, with the seat that played it (public information) */
  playedCards: TrickPlay[];
  score: Record<Team, number>;
  history: HandRecord[];
  winner: Team | null;
  rev: number;
  log: string[];
  /**
   * All four hands, visible only when the hand is over and rules.revealHands is on.
   * `atPlay` is each hand as trick play began (after passing); `dealt` is before passing.
   */
  revealed: { dealt: Record<SeatIndex, CardId[]>; atPlay: Record<SeatIndex, CardId[]> } | null;
  /** actions legal for this seat right now, precomputed so the UI never guesses */
  legal: LegalActions;
}

export interface LegalActions {
  canBid: boolean;
  minBid: number | null;
  canPassBid: boolean;
  /** may declare a shoot right now (rules.shoot !== "off", bidding, on turn, nobody has shot yet) */
  canShoot: boolean;
  canDeclareTrump: boolean;
  /** number of cards that must be chosen when passing, or null */
  mustPassCount: number | null;
  canDeclareMeld: boolean;
  canConfirmMeld: boolean;
  /** card ids that may legally be played right now (empty when not your turn) */
  playableCards: CardId[];
  playConstraint: PlayConstraint | null;
  canAdvanceHand: boolean;
}

export class IllegalAction extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IllegalAction";
  }
}
