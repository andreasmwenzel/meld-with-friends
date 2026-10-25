import { newGame } from './game';
import type { GameState } from './types';

/** Curated opening deal. See docs/PRACTICE_DEAL.md before changing this seed. */
export function newPracticeGame(): GameState {
  return newGame('practice-v1-1784606', { scoring: 'modern', revealHands: true });
}
