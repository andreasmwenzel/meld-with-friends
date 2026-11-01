/**
 * The games the house plays. Shared by the lobby, the table and the server; no engine code here, so a client
 * bundle that only lists the games pulls in neither engine.
 */
export type GameKind = "pinochle" | "hearts";

export interface GameKindInfo {
  id: GameKind;
  name: string;
  /** one line under the name, in the lobby and on the front door */
  line: string;
  /** a sentence on the deal sheet */
  blurb: string;
  /** partners sit across from each other */
  teams: boolean;
  /** cards in the deck, so the lobby can say "48 cards, two of each" */
  deck: string;
}

export const GAME_KINDS: readonly GameKindInfo[] = [
  {
    id: "pinochle", name: "Pinochle", line: "Partners, bids and meld. First to 150.",
    blurb: "Four-hand partnership pinochle with the 48-card deck. Bid, name trump, pass to your partner, lay your meld, take tricks.",
    teams: true, deck: "48 cards, two of each",
  },
  {
    id: "hearts", name: "Hearts", line: "Every player for themselves. Lowest score wins.",
    blurb: "Four players, 52 cards, no partners. Pass three cards, dodge the hearts and the queen of spades, or take them all and shoot the moon.",
    teams: false, deck: "52 cards",
  },
];

export const DEFAULT_GAME_KIND: GameKind = "pinochle";

export function isGameKind(value: unknown): value is GameKind {
  return GAME_KINDS.some((g) => g.id === value);
}

export function gameInfo(kind: GameKind | string | undefined | null): GameKindInfo {
  return GAME_KINDS.find((g) => g.id === kind) ?? GAME_KINDS[0];
}
