import { describe, expect, it } from 'vitest';
import { chooseAction } from '../ai';
import { bidCeiling, partnerSignal, projectedValue, SIGNAL } from '../ai/bid';
import { bidStrength, cardWeights, knowledge, sampleDeal } from '../ai/knowledge';
import { random } from '../ai/shared';
import { DEFAULT_SETTINGS } from '@/lib/settings';
import { applyAction, newGame, viewFor } from '../game';
import type { Bid, CardId, PlayerView, SeatIndex } from '../types';

const bonus = DEFAULT_SETTINGS.bots.partnerBidBonus;
// South (0) is the bot; North (2) is its partner; West (1) and East (3) are opponents.
const moderate: CardId[] = ['AS0', 'TS0', 'KS0', '9S0', '9S1', 'AH0', 'KH0', 'QH0', 'JD0', 'QD0', '9C0', 'JC0'];
const monster: CardId[] = ['AS0', 'AS1', 'TS0', 'KS0', 'QS0', 'JS0', 'QS1', '9S0', 'AH0', 'AD0', 'JD0', 'AC0'];

/** A modern-scoring bidding view for South with the given public auction. */
function biddingView(hand: CardId[], bids: Bid[]): PlayerView {
  const view = viewFor(newGame('conventions'), 0);
  const highBid = bids.filter(b => b.amount !== null).at(-1) ?? null;
  const minBid = highBid ? highBid.amount! + 1 : view.rules.minBid;
  return { ...view, hand, bids, highBid, turn: 0,
    legal: { ...view.legal, canBid: true, minBid, canPassBid: true, canShoot: false, canMisdeal: false } };
}

describe('partner auction', () => {
  const partnerHolds: Bid[] = [{ seat: 1, amount: null }, { seat: 2, amount: 25 }, { seat: 3, amount: null }];

  it('lets partner win once both opponents have passed', () => {
    const view = biddingView(moderate, partnerHolds);
    // The hand is worth a raise counting on partner, so the old rule bid against partner here.
    expect(bidCeiling(view)).toBeGreaterThanOrEqual(26);
    expect(bidCeiling(view, DEFAULT_SETTINGS.bots, SIGNAL.passed)).toBeLessThan(26);
    expect(chooseAction(view)).toEqual({ type: 'pass_bid', seat: 0 });
  });

  it('takes over when its own hand carries the higher contract', () => {
    const view = biddingView(monster, partnerHolds);
    expect(bidCeiling(view, DEFAULT_SETTINGS.bots, SIGNAL.passed)).toBeGreaterThanOrEqual(26);
    expect(chooseAction(view)).toEqual({ type: 'bid', seat: 0, amount: 26 });
  });

  it('still competes with the same hand against an opponent', () => {
    const view = biddingView(moderate, [{ seat: 1, amount: null }, { seat: 2, amount: 25 }, { seat: 3, amount: 26 }]);
    expect(chooseAction(view)).toEqual({ type: 'bid', seat: 0, amount: 27 });
  });

  it('never raises partner in seeded four-bot auctions unless the hand alone justifies it', () => {
    let partnerRaises = 0, auctions = 0;
    for (let i = 0; i < 300; i++) {
      let state = newGame(`partner-race:${i}`, {}, (i % 4) as SeatIndex);
      auctions++;
      while (state.phase === 'bidding') {
        const view = viewFor(state, state.turn!);
        const action = chooseAction(view, { budgetMs: 0, seed: `${i}:${state.rev}` });
        if (action.type === 'bid' && view.highBid?.seat === (view.seat + 2) % 4) {
          partnerRaises++;
          expect(action.amount).toBeLessThanOrEqual(bidCeiling(view, DEFAULT_SETTINGS.bots, SIGNAL.passed));
        }
        state = applyAction(state, action);
      }
    }
    // Takeover hands are rare; the old rule raised partner several times per auction.
    expect(partnerRaises).toBeLessThan(auctions / 4);
  });
});

describe('partner signals', () => {
  it('reads each kind of partner call', () => {
    const signal = (bids: Bid[]) => partnerSignal(biddingView(moderate, bids));
    expect(signal([])).toBe(SIGNAL.unknown);
    expect(signal([{ seat: 2, amount: null }])).toBe(SIGNAL.passed);
    expect(signal([{ seat: 1, amount: 25 }, { seat: 2, amount: null }])).toBe(SIGNAL.passed);
    // Passing over our own side's bid is not weakness, just no reason to take over.
    expect(signal([{ seat: 0, amount: 25 }, { seat: 1, amount: null }, { seat: 2, amount: null }])).toBe(SIGNAL.unknown);
    expect(signal([{ seat: 2, amount: 25 }])).toBe(SIGNAL.bid + bonus);
    expect(signal([{ seat: 2, amount: 25 }, { seat: 3, amount: 26 }, { seat: 0, amount: 27 }, { seat: 1, amount: null }, { seat: 2, amount: null }])).toBe(SIGNAL.bid + bonus);
    // A jump over the cheapest legal bid shows meld, up to two steps.
    expect(signal([{ seat: 1, amount: 25 }, { seat: 2, amount: 27 }])).toBe(SIGNAL.bid + bonus + SIGNAL.perJumpStep);
    expect(signal([{ seat: 2, amount: 40 }])).toBe(SIGNAL.bid + bonus + 2 * SIGNAL.perJumpStep);
  });

  it('raises the projection with the signal', () => {
    const value = (bids: Bid[]) => projectedValue(biddingView(moderate, bids), 'S');
    const passed = value([{ seat: 2, amount: null }]), unknown = value([]), bid = value([{ seat: 2, amount: 25 }]), jump = value([{ seat: 2, amount: 27 }]);
    expect(passed).toBeLessThan(unknown);
    expect(unknown).toBeLessThan(bid);
    expect(bid).toBeLessThan(jump);
  });
});

describe('bid-history sampling', () => {
  function playingView(seed: string) {
    let state = newGame(seed);
    while (state.phase !== 'playing') {
      const seat = state.phase === 'melding' ? state.players.find(p => !p.meldConfirmed)!.seat : state.turn!;
      state = applyAction(state, chooseAction(viewFor(state, seat), { budgetMs: 0, seed: `${seed}:${state.rev}` }));
    }
    return { state, view: viewFor(state, ((state.bidder! + 1) % 4) as SeatIndex) };
  }
  /** Mean number of `pick` cards each seat is dealt in samples, among cards the viewer cannot place. */
  function shares(view: PlayerView, pick: (c: CardId) => boolean, n = 400) {
    const unknown = new Set(knowledge(view).unknown);
    const totals = [0, 0, 0, 0];
    const rng = random('shares');
    for (let i = 0; i < n; i++) sampleDeal(view, rng)!.forEach((hand, s) => { totals[s] += hand.filter(c => unknown.has(c) && pick(c)).length / n; });
    return totals;
  }

  it('scores bidders above passers', () => {
    const view = biddingView(moderate, [{ seat: 1, amount: null }, { seat: 2, amount: 25 }, { seat: 3, amount: 35 }]);
    expect(bidStrength(view, 0)).toBe(0);
    expect(bidStrength(view, 1)).toBeLessThan(0);
    expect(bidStrength(view, 2)).toBeGreaterThan(0);
    expect(bidStrength(view, 3)).toBe(1);
    const weight = cardWeights(view);
    expect(weight(3, 'AH0')).toBeGreaterThan(weight(2, 'AH0'));
    expect(weight(2, 'AH0')).toBeGreaterThan(weight(1, 'AH0'));
    expect(weight(1, '9H0')).toBe(1);
  });

  it('gives aces to the seat that bid and takes them from the seat that passed', () => {
    const { view } = playingView('weights');
    const [a, b] = [((view.seat + 1) % 4) as SeatIndex, ((view.seat + 3) % 4) as SeatIndex];
    const ace = (c: CardId) => c[0] === 'A';
    const flat = shares({ ...view, bids: [] }, ace);
    const aBids = shares({ ...view, bids: [{ seat: a, amount: 30 }, { seat: b, amount: null }] }, ace);
    const bBids = shares({ ...view, bids: [{ seat: b, amount: 30 }, { seat: a, amount: null }] }, ace);
    expect(aBids[a]).toBeGreaterThan(flat[a] + .1);
    expect(aBids[b]).toBeLessThan(flat[b] - .1);
    expect(bBids[b]).toBeGreaterThan(flat[b] + .1);
    expect(bBids[a]).toBeLessThan(flat[a] - .1);
  });

  it('puts more trump with the declarer than with the declarer\'s partner', () => {
    const { view } = playingView('declarer-trump');
    const trump = (c: CardId) => c[1] === view.trump;
    const bidder = view.bidder!, partner = ((bidder + 2) % 4) as SeatIndex;
    const weighted = shares(view, trump), flat = shares({ ...view, bids: [], bidder: null }, trump);
    expect(weighted[bidder] - weighted[partner]).toBeGreaterThan(flat[bidder] - flat[partner] + .3);
  });

  it('knows the cards it passed are still with its partner', () => {
    const { state } = playingView('passed-cards');
    const partner = ((state.bidder! + 2) % 4) as SeatIndex;
    for (const seat of [state.bidder!, partner]) {
      const view = viewFor(state, seat);
      const known = knowledge(view).known[(seat + 2) % 4];
      const kept = view.recap.myPassedOut.filter(c => !view.hand.includes(c));
      expect(kept.length).toBeGreaterThan(0);
      for (const card of kept) expect(known).toContain(card);
    }
  });
});
