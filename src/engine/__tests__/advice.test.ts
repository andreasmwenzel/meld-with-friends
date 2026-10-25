import { describe, expect, it } from 'vitest';
import { applyAction, computeMeld, newGame, newPracticeGame, viewFor } from '../index';
import { chooseAction } from '../ai';
import { advise, adviseBid, advisePass, advisePlay, adviseTrump, bidEstimate, listCards, nearMelds } from '../coach/advice';
import { buildScenario } from '../scenario';
import type { CardId, GameState, SeatIndex } from '../types';

const names: Record<SeatIndex, string> = { 0: 'You', 1: 'Margaret', 2: 'Walt', 3: 'June' };
const nameOf = (s: SeatIndex) => names[s];
const fast = { seed: 'advice', config: { samples: 8, budgetMs: 5 } };

/** Seat to act next; while melding, the first seat still to confirm. */
const actor = (s: GameState) => (s.phase === 'melding' ? s.players.find(p => !p.meldConfirmed)!.seat : s.turn!) as SeatIndex;

/** The curated practice deal up to South's first decision. */
function practiceToSouth(): GameState {
  let state = newPracticeGame();
  while (actor(state) !== 0) state = applyAction(state, chooseAction(viewFor(state, actor(state))));
  return state;
}

/** Follow the advice for South and the bots elsewhere until `stop` holds. */
function follow(state: GameState, stop: (s: GameState) => boolean, seen: string[] = []): GameState {
  for (let i = 0; i < 400 && !stop(state); i++) {
    const seat = actor(state);
    const view = viewFor(state, seat);
    if (seat === 0) {
      const advice = advise(view, { nameOf });
      expect(advice, `advice in ${state.phase}`).not.toBeNull();
      seen.push(state.phase);
      state = applyAction(state, advice!.action);
    } else state = applyAction(state, chooseAction(view, { ...fast, seed: `${state.rev}` }));
  }
  return state;
}

describe('coach advice on the curated practice deal', () => {
  it('suggests a bid with a limit that wins the auction at 31', () => {
    const state = practiceToSouth();
    const view = viewFor(state, 0);
    const est = bidEstimate(view);
    expect(est).toMatchObject({ trump: 'H', meld: 11, ceiling: 31 });
    expect(est.near?.needs).toBe('JH');
    const advice = adviseBid(view, { nameOf })!;
    expect(advice.action).toEqual({ type: 'bid', seat: 0, amount: 27 });
    expect(advice.headline).toBe('Bid 27, up to 31');
    expect(advice.reason).toContain('Your meld in hearts is 11');
    expect(advice.reason).toContain('Walt passed');
    expect(advice.reason).toContain('J♥');
    expect(advice.cards.length).toBeGreaterThan(0);
    const won = follow(state, s => s.phase !== 'bidding');
    expect(won).toMatchObject({ phase: 'declaring_trump', bidder: 0, highBid: { amount: 31 } });
  });

  it('names hearts for length and the nearly complete run', () => {
    const state = follow(practiceToSouth(), s => s.phase !== 'bidding');
    const advice = adviseTrump(viewFor(state, 0), { nameOf })!;
    expect(advice.action).toEqual({ type: 'declare_trump', seat: 0, suit: 'H' });
    expect(advice.reason).toContain('5 hearts, with A 10 K Q');
    expect(advice.reason).toContain('J♥ from a run');
    expect(advice.cards.every(c => c[1] === 'H')).toBe(true);
  });

  it('passes back side cards and keeps the run, pinochle and spade marriage', () => {
    const state = follow(practiceToSouth(), s => s.phase === 'passing_back');
    const view = viewFor(state, 0);
    const advice = advisePass(view, { nameOf })!;
    expect(advice.cards).toEqual(['9C0', 'KC1', 'TC1', 'AD0']);
    expect(advice.reason).toContain('run in hearts, marriage in spades and pinochle');
    expect(advice.reason).toContain('void');
    expect(advice.reason).toContain('Walt can still win with A♦');
    const kept = view.hand.filter(c => !advice.cards.includes(c));
    expect(computeMeld(kept, 'H', view.rules).total).toBe(22);
  });

  it('gives a legal suggestion at every decision through the whole hand', () => {
    const seen: string[] = [];
    const over = follow(practiceToSouth(), s => s.phase === 'hand_over', seen);
    expect(over.phase).toBe('hand_over');
    expect(new Set(seen)).toEqual(new Set(['bidding', 'declaring_trump', 'passing_back', 'melding', 'playing']));
    expect(over.history[0]).toMatchObject({ bidder: 0, bid: 31, wentSet: false });
  });
});

describe('passing to the bidder', () => {
  const spec = (hand: string[]) => buildScenario({ dealer: 3, bidder: 2, bid: 28, trump: 'H', to: 'passing_to_bidder', hands: { 0: hand } }).state;

  it('sends trump and aces, keeps a marriage, and says why', () => {
    const view = viewFor(spec(['KH', '9H', 'AS', 'AC', 'QS', 'KD', 'QD', '9S', 'JS', '9C', 'JC', 'TC']), 0);
    const advice = advisePass(view, { nameOf })!;
    expect([...advice.cards].sort()).toEqual(['9H0', 'AC0', 'AS0', 'KH0'].sort());
    expect(advice.reason).toContain('royal marriage or a run');
    expect(advice.reason).toContain('Keep your marriage in diamonds');
  });

  it('sends Q♠ that could complete the bidder\'s pinochle', () => {
    const view = viewFor(spec(['KH', '9H', 'AS', 'QS', 'KD', 'QD', '9S', 'JS', '9C', 'JC', 'TC', '9D']), 0);
    const advice = advisePass(view, { nameOf })!;
    expect(advice.cards).toContain('QS0');
    expect(advice.reason).toContain('pinochle');
  });

  it('keeps its own pinochle rather than splitting it', () => {
    const view = viewFor(spec(['KH', '9H', 'AS', 'AC', 'QS', 'JD', '9S', 'JS', '9C', 'JC', 'TC', '9D']), 0);
    const advice = advisePass(view, { nameOf })!;
    expect(advice.cards).not.toContain('QS0');
    expect(advice.cards).not.toContain('JD0');
    expect(advice.reason).toContain('Keep your pinochle');
  });
});

describe('advice helpers', () => {
  it('finds one-card completions with a chance the partner holds them', () => {
    const hand = ['AH0', 'TH0', 'KH0', 'QH0', '9S0', '9S1', '9C0', '9C1', '9D0', '9D1', 'JS0', 'JC0'] as CardId[];
    const [first] = nearMelds(hand, 'H', newGame('x').rules);
    expect(first.needs).toBe('JH');
    expect(first.gain).toBe(11);
    expect(first.chance).toBeCloseTo(1 - (24 * 23) / (36 * 35));
  });

  it('states bids in the table scale', () => {
    let state = newGame('practice-v1-1784606', { scoring: 'classic', revealHands: true });
    while (actor(state) !== 0) state = applyAction(state, chooseAction(viewFor(state, actor(state))));
    const view = viewFor(state, 0);
    const advice = adviseBid(view)!;
    expect(bidEstimate(view).ceiling).toBe(310);
    expect(advice.headline).toBe(`Bid ${view.legal.minBid}, up to 310`);
    expect(advice.reason).toContain('hearts is 110');
  });

  it('suggests passing once the bid is past the limit', () => {
    const state = buildScenario({ dealer: 0, to: 'bidding', bids: [40, null, 45], hands: { 0: ['9S', '9S', 'JC', 'JC', '9D', '9D', 'JH', '9H', 'TC', 'QD', 'JS', '9C'] } }).state;
    const advice = adviseBid(viewFor(state, 0))!;
    expect(advice.action.type).toBe('pass_bid');
    expect(advice.headline).toBe('Pass');
  });

  it('suggests leading trump to pull it when your side bid', () => {
    const state = buildScenario({ dealer: 3, bidder: 0, bid: 30, trump: 'S', to: 'playing', rules: { passCount: 0 },
      hands: { 0: ['AS', 'TS', 'KS', 'QS', 'JS', '9S', 'AH', 'AD', 'AC', 'KH', 'KD', 'KC'] } }).state;
    const advice = advisePlay(viewFor(state, 0))!;
    expect(advice.cards[0][1]).toBe('S');
    expect(advice.reason).toContain('pulls');
  });

  it('only suggests legal plays, across many deals', () => {
    for (let i = 0; i < 12; i++) {
      let state = newGame(`advice-fuzz:${i}`, {}, (i % 4) as SeatIndex);
      for (let step = 0; step < 400 && state.phase !== 'hand_over'; step++) {
        const seat = actor(state);
        const view = viewFor(state, seat);
        if (seat === 0 && view.phase === 'playing') {
          const advice = advisePlay(view)!;
          expect(view.legal.playableCards).toContain(advice.cards[0]);
          state = applyAction(state, advice.action);
        } else state = applyAction(state, chooseAction(view, { ...fast, seed: `${i}:${state.rev}` }));
      }
      expect(state.phase).toBe('hand_over');
    }
  });

  it('lists cards in plain English', () => {
    expect(listCards(['9C0', 'KC1', 'TC1'])).toBe('9♣, K♣ and 10♣');
    expect(listCards(['AS0'])).toBe('A♠');
  });
});

describe('bid advice when passing is the only call', () => {
  it('says the dealer takes it when stuck, and passes otherwise', () => {
    const stuck = buildScenario({ dealer: 0, bids: [null, null, null] }).state;
    expect(adviseBid(viewFor(stuck, 0))?.headline).toMatch(/^Take it at/);
    const redeal = buildScenario({ dealer: 0, rules: { dealerStuck: false }, bids: [null, null, null] }).state;
    expect(adviseBid(viewFor(redeal, 0))).toMatchObject({ headline: 'Pass', reason: expect.stringMatching(/redeal/) });
    const shot = buildScenario({ dealer: 0, rules: { shoot: 'points' }, bids: ['shoot', null, null] }).state;
    expect(adviseBid(viewFor(shot, 0))).toMatchObject({ headline: 'Pass', reason: expect.stringMatching(/shot the moon/) });
  });
});
