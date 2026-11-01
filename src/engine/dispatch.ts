/**
 * One door to both engines, keyed by the table's game kind. The server and the dev boards go through here;
 * a game board imports its own engine directly.
 */
import type { GameKind } from "./kinds";
import { applyAction, newGame, viewFor } from "./game";
import { resolveRules } from "./scoring";
import { chooseAction } from "./ai";
import type { Action, GameState, PlayerView, RulesConfig, SeatIndex } from "./types";
import { applyHeartsAction, chooseHeartsAction, heartsViewFor, newHeartsGame, resolveHeartsRules } from "./hearts";
import type { HeartsAction, HeartsRules, HeartsState, HeartsView } from "./hearts/types";

export type AnyState = GameState | HeartsState;
export type AnyAction = Action | HeartsAction;
export type AnyView = PlayerView | HeartsView;
export type AnyRules = RulesConfig | HeartsRules;

export const isHearts = (state: AnyState): state is HeartsState => (state as HeartsState).kind === "hearts";
export const kindOf = (state: AnyState): GameKind => isHearts(state) ? "hearts" : "pinochle";

export function resolveRulesFor(kind: GameKind, rules: unknown): AnyRules {
  return kind === "hearts" ? resolveHeartsRules((rules ?? {}) as Partial<HeartsRules>) : resolveRules((rules ?? {}) as Partial<RulesConfig>);
}

export function newGameFor(kind: GameKind, seed: string, rules: unknown, dealer: SeatIndex = 0): AnyState {
  return kind === "hearts"
    ? newHeartsGame(seed, (rules ?? {}) as Partial<HeartsRules>, dealer)
    : newGame(seed, (rules ?? {}) as Partial<RulesConfig>, dealer);
}

export function applyFor(state: AnyState, action: AnyAction): AnyState {
  return isHearts(state) ? applyHeartsAction(state, action as HeartsAction) : applyAction(state, action as Action);
}

export function viewForAny(state: AnyState, seat: SeatIndex): AnyView {
  return isHearts(state) ? heartsViewFor(state, seat) : viewFor(state, seat);
}

/** The computer player's move for the seat on turn. */
export function botActionFor(state: AnyState, seat: SeatIndex, seed: string, config: NonNullable<Parameters<typeof chooseAction>[1]>["config"]): AnyAction {
  return isHearts(state) ? chooseHeartsAction(heartsViewFor(state, seat), seed) : chooseAction(viewFor(state, seat), { seed, config });
}

/** Seats whose move is awaited while the table waits on several at once (pinochle meld, the hearts pass). */
export function seatsAwaited(state: AnyState): SeatIndex[] {
  if (isHearts(state)) return state.phase === "passing" ? state.players.filter((p) => !p.passed).map((p) => p.seat) : state.turn === null ? [] : [state.turn];
  if (state.phase === "melding") return state.players.filter((p) => !p.meldConfirmed).map((p) => p.seat);
  return state.turn === null ? [] : [state.turn];
}
