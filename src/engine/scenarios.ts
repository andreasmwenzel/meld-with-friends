// Named edge-case positions for the dev lab, screenshots and tests. Seat 0 (South) is "you" unless `view` says otherwise.
import type { SeatIndex } from './types';
import type { ScenarioSpec } from './scenario';

export interface Preset {
  id: string;
  group: 'Bidding' | 'Trump & passing' | 'Meld' | 'Trick play' | 'Hand over' | 'Game' | 'Rules';
  title: string;
  /** what this position exercises, one line */
  note: string;
  spec: ScenarioSpec;
  /** seat to look from (default 0) */
  view?: SeatIndex;
  /** seats the lab hands to bots when this preset loads (default every seat but the viewer) */
  bots?: SeatIndex[];
}

// South holds no clubs, so a club lead forces a trump. Cards the script plays are pinned to their seats.
const VOID_IN_CLUBS = ['AS', 'KS', '9S', 'AH', 'TH', 'KH', 'QH', 'AD', 'TD', 'KD', 'QD', 'JD'];
// Every spade: South takes all twelve tricks with spades as trump.
const ALL_SPADES = ['AS', 'AS', 'TS', 'TS', 'KS', 'KS', 'QS', 'QS', 'JS', 'JS', '9S', '9S'];
const BIG_MELD = ['AS', 'TS', 'KS', 'QS', 'JS', 'AH', 'AD', 'AC', 'QS', 'JD', 'JD', 'KH'];

export const PRESETS: Preset[] = [
  { id: 'bid-open', group: 'Bidding', title: 'Open the bidding', note: 'Your first call, nothing bid yet.',
    spec: { dealer: 3 } },
  { id: 'bid-contested', group: 'Bidding', title: 'Contested auction', note: 'Three bids in; you must top 30 or pass.',
    spec: { dealer: 0, bids: [25, 26, 30] } },
  { id: 'bid-stuck', group: 'Bidding', title: 'Dealer stuck', note: 'Everyone passed to you as dealer; you take the minimum.',
    spec: { dealer: 0, bids: [null, null, null] } },
  { id: 'bid-redeal', group: 'Bidding', title: 'All pass, redeal on', note: 'Dealer stuck is off; your pass redeals.',
    spec: { dealer: 0, rules: { scoring: 'modern', dealerStuck: false }, bids: [null, null, null] } },
  { id: 'bid-shoot', group: 'Bidding', title: 'Shoot available', note: 'Shooting the moon wins the game; a monster hand to try it with.',
    spec: { dealer: 3, rules: { scoring: 'modern', shoot: 'game' }, hands: { 0: ALL_SPADES } } },
  { id: 'bid-misdeal', group: 'Bidding', title: 'Nines misdeal', note: 'Five nines and no other meld; you may throw the hand in.',
    spec: { dealer: 3, hands: { 0: ['9S', '9S', '9H', '9H', '9D', 'AS', 'AS', 'TS', 'TH', 'TD', 'AC', 'TC'] } } },
  { id: 'bid-after-shoot', group: 'Bidding', title: 'After a shoot', note: 'West shot the moon; you can only pass.',
    spec: { dealer: 0, rules: { scoring: 'modern', shoot: 'points', shootPoints: 100 }, bids: ['shoot', null, null] } },

  { id: 'trump-pick', group: 'Trump & passing', title: 'Name trump', note: 'You won at 30 with a big meld hand.',
    spec: { dealer: 3, bidder: 0, bid: 30, hands: { 0: BIG_MELD }, to: 'declaring_trump' } },
  { id: 'pass-to-bidder', group: 'Trump & passing', title: 'Pass to your partner', note: 'North won; choose four cards for them.',
    spec: { dealer: 0, bidder: 2, bid: 28, trump: 'H', to: 'passing_to_bidder' } },
  { id: 'pass-back', group: 'Trump & passing', title: 'Pass back', note: 'You hold 16 after your partner passed; return four.',
    spec: { dealer: 3, bidder: 0, bid: 32, trump: 'D', to: 'passing_back' } },
  { id: 'pass-waiting', group: 'Trump & passing', title: 'Waiting on a pass', note: 'East won and West is choosing cards; nothing for you to do.',
    spec: { dealer: 2, bidder: 3, bid: 26, trump: 'C', to: 'passing_to_bidder' } },

  { id: 'meld-double-run', group: 'Meld', title: 'Double run', note: '150 in meld: the biggest readout.',
    spec: { dealer: 3, bidder: 0, bid: 40, trump: 'S', hands: { 0: ['AS', 'AS', 'TS', 'TS', 'KS', 'KS', 'QS', 'QS', 'JS', 'JS', 'AH', 'AD'] },
      rules: { scoring: 'modern', passCount: 0 }, to: 'melding' } },
  { id: 'meld-everything', group: 'Meld', title: 'Crowded meld', note: 'Run, double pinochle, aces around and dix: a long readout.',
    spec: { dealer: 3, bidder: 0, bid: 35, trump: 'S', hands: { 0: [...BIG_MELD.slice(0, 11), '9S'] }, rules: { scoring: 'modern', passCount: 0 }, to: 'melding' } },
  { id: 'meld-nothing', group: 'Meld', title: 'No meld', note: 'Nines and jacks only; nothing to lay down.',
    spec: { dealer: 3, bidder: 1, bid: 25, trump: 'S', hands: { 0: ['9H', '9H', '9D', '9D', '9C', '9C', 'JH', 'JC', 'JC', 'TH', 'TD', 'TC'] }, rules: { scoring: 'modern', passCount: 0 }, to: 'melding' } },
  { id: 'meld-waiting', group: 'Meld', title: 'Confirmed, waiting', note: 'You confirmed; the table is still melding.',
    spec: { dealer: 3, bidder: 0, bid: 30, trump: 'H', to: 'melding', confirmed: [0] }, bots: [] },
  { id: 'meld-review', group: 'Meld', title: 'Meld on the table', note: 'Everyone has melded; trick play is about to start.',
    spec: { dealer: 3, bidder: 1, bid: 29, trump: 'C', to: 'playing', turn: 1 }, bots: [] },

  { id: 'play-lead', group: 'Trick play', title: 'Your lead', note: 'You won the bid and lead the first trick.',
    spec: { dealer: 3, bidder: 0, bid: 30, trump: 'S', to: 'playing' } },
  { id: 'play-must-trump', group: 'Trick play', title: 'Must trump', note: 'Clubs led and you are void: only spades are playable.',
    spec: { dealer: 0, bidder: 1, bid: 26, trump: 'S', rules: { scoring: 'modern', passCount: 0 },
      hands: { 0: VOID_IN_CLUBS, 1: ['AC', 'TC'], 2: ['9C', 'QC'], 3: ['JC', 'KC'] }, play: ['AC', '9C', 'JC'], to: 'playing', turn: 0 } },
  { id: 'play-must-head', group: 'Trick play', title: 'Must head the trick', note: 'Low heart led; you must beat it with a higher heart.',
    spec: { dealer: 0, bidder: 1, bid: 26, trump: 'S', rules: { scoring: 'modern', passCount: 0 },
      hands: { 0: ['AS', 'KS', '9S', 'AH', 'AH', 'TH', 'TH', 'AD', 'TD', 'KD', 'QD', 'JD'], 1: ['9H'], 2: ['JH'], 3: ['QH'] },
      play: ['9H', 'JH', 'QH'], to: 'playing', turn: 0 } },
  { id: 'play-must-overtrump', group: 'Trick play', title: 'Must overtrump', note: 'North trumped a club; you must trump higher.',
    spec: { dealer: 1, bidder: 2, bid: 26, trump: 'S', rules: { scoring: 'modern', passCount: 0 },
      hands: { 0: VOID_IN_CLUBS, 2: ['AC'], 3: ['AH', 'TH', 'KH', 'QH', 'JH', '9H', 'AD', 'TD', 'KD', 'QD', 'JD', 'JS'] },
      play: ['AC', 'JS'], to: 'playing', turn: 0 } },
  { id: 'play-complete-trick', group: 'Trick play', title: 'Complete the trick', note: 'Three cards down; yours decides it.',
    spec: { dealer: 0, bidder: 1, bid: 25, trump: 'H', to: 'playing', tricks: 3, turn: 0, plays: 3 } },
  { id: 'play-mid-hand', group: 'Trick play', title: 'Mid hand', note: 'Six tricks gone, scores building.',
    spec: { dealer: 1, bidder: 2, bid: 29, trump: 'D', to: 'playing', tricks: 6, turn: 0 } },
  { id: 'play-last-trick', group: 'Trick play', title: 'Last trick', note: 'One card each; the last trick bonus is on the line.',
    spec: { dealer: 2, bidder: 3, bid: 27, trump: 'C', to: 'playing', tricks: 11, turn: 0 } },
  { id: 'play-waiting', group: 'Trick play', title: 'Waiting on others', note: 'Bots are thinking; watch the pace.',
    spec: { dealer: 0, bidder: 1, bid: 25, trump: 'S', to: 'playing', tricks: 2, turn: 1 } },

  { id: 'hand-made', group: 'Hand over', title: 'Bid made', note: 'Hand over with every hand revealed.',
    spec: { dealer: 3, bidder: 0, bid: 25, hands: { 0: BIG_MELD }, trump: 'S', to: 'hand_over' } },
  { id: 'hand-set', group: 'Hand over', title: 'Went set', note: 'You bid 65 on nothing and paid for it.',
    spec: { dealer: 3, bidder: 0, bid: 65, hands: { 0: ['9H', '9H', '9D', '9D', '9C', '9C', 'JH', 'JC', 'JC', 'QH', 'QD', 'QC'] }, trump: 'H', to: 'hand_over' } },
  { id: 'hand-meld-lost', group: 'Hand over', title: 'Meld lost, no tricks', note: 'The defence took no trick, so its meld does not count.',
    spec: { dealer: 3, bidder: 0, bid: 30, trump: 'S', rules: { scoring: 'modern', passCount: 0, target: 500 }, hands: { 0: ALL_SPADES, 1: ['AH', 'AD', 'AC', 'KH', 'QH'] }, to: 'hand_over' } },
  { id: 'hand-shoot-made', group: 'Hand over', title: 'Shoot made (points)', note: 'Every trick taken for the shoot bonus.',
    spec: { dealer: 3, bidder: 0, shoot: true, trump: 'S', rules: { scoring: 'modern', shoot: 'points', shootPoints: 100, passCount: 0 }, hands: { 0: ALL_SPADES }, to: 'hand_over' } },
  { id: 'hand-shoot-missed', group: 'Hand over', title: 'Shoot missed', note: 'The shoot fails on the first lost trick; hands stay part-played.',
    spec: { dealer: 3, bidder: 0, shoot: true, trump: 'H', rules: { scoring: 'modern', shoot: 'points', shootPoints: 100, passCount: 0 },
      hands: { 0: ['9C', '9C', 'JC', 'JC', '9D', '9D', 'JD', 'JD', '9S', '9S', 'JS', 'JS'] }, to: 'hand_over' } },

  { id: 'game-won', group: 'Game', title: 'Game won', note: 'Red crosses 150 on this hand.',
    spec: { dealer: 3, handNumber: 8, score: { red: 138, blue: 112 }, bidder: 0, bid: 25, trump: 'S', rules: { scoring: 'modern', passCount: 0 }, hands: { 0: ALL_SPADES }, to: 'game_over' } },
  { id: 'game-lost', group: 'Game', title: 'Game lost', note: 'Blue wins; the loss screen.',
    spec: { dealer: 0, handNumber: 9, score: { red: 90, blue: 144 }, bidder: 1, bid: 25, trump: 'S', rules: { scoring: 'modern', passCount: 0 }, hands: { 1: ALL_SPADES }, to: 'game_over' } },
  { id: 'game-shoot-win', group: 'Game', title: 'Shoot wins the game', note: 'Moon shot in "game" mode ends it on the spot.',
    spec: { dealer: 3, bidder: 0, shoot: true, trump: 'S', rules: { scoring: 'modern', shoot: 'game', passCount: 0 }, hands: { 0: ALL_SPADES }, to: 'game_over' } },
  { id: 'game-late', group: 'Game', title: 'Late, close game', note: 'Hand 11, a long scorepad, 3 points apart.',
    spec: { handNumber: 11, score: { red: 131, blue: 134 } } },
  { id: 'game-negative', group: 'Game', title: 'Negative score', note: 'Red has gone set into the red.',
    spec: { handNumber: 4, score: { red: -42, blue: 61 }, bidder: 0, bid: 26, to: 'playing', tricks: 4, turn: 0 } },

  { id: 'rules-classic', group: 'Rules', title: 'Classic counting', note: 'A 11, 10 10, K 4, Q 3, J 2 mid hand.',
    spec: { rules: { scoring: 'classic', counting: 'classic' }, dealer: 1, bidder: 2, bid: 250, to: 'playing', tricks: 5, turn: 0 } },
  { id: 'rules-no-pass', group: 'Rules', title: 'No passing', note: 'passCount 0 goes straight from trump to meld.',
    spec: { rules: { scoring: 'modern', passCount: 0 }, dealer: 3, bidder: 0, bid: 26, trump: 'H', to: 'melding' } },
  { id: 'rules-leisurely', group: 'Rules', title: 'Leisurely pace', note: 'Leisurely tables open the recap on return.',
    spec: { rules: { scoring: 'modern', pace: 'leisurely' }, dealer: 1, bidder: 2, bid: 28, to: 'playing', tricks: 4, turn: 0 } },
  { id: 'rules-low-target', group: 'Rules', title: 'Short game', note: 'Target 50, min bid 15 by 1s.',
    spec: { rules: { scoring: 'modern', target: 50, minBid: 15, bidStep: 1 }, dealer: 0, bids: [15, 16, null] } },
];

export const presetById = (id: string) => PRESETS.find(p => p.id === id);
