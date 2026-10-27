import type { BotConfig } from '../../lib/settings';
import { applyAction, newGame, viewFor } from '../game';
import { chooseAction } from './index';
import { random } from './shared';
import type { Action, PlayerView, SeatIndex } from '../types';
export function randomAction(v: PlayerView, rng: () => number): Action {
  const seat=v.seat, l=v.legal;
  const pick=<T>(a:T[])=>a[Math.floor(rng()*a.length)];
  if (l.canAdvanceHand) return {type:'next_hand',seat};
  // A cautious legal baseline: pass or bid one increment, never invent a bid ceiling.
  if (l.canPassBid) return l.canBid && rng()<.25 ? {type:'bid',seat,amount:l.minBid!} : {type:'pass_bid',seat};
  if (l.canDeclareTrump) return {type:'declare_trump',seat,suit:pick(['S','H','D','C'] as const)};
  if (l.mustPassCount!==null) return {type:'pass_cards',seat,cards:[...v.hand].map(c=>({c,n:rng()})).sort((a,b)=>a.n-b.n).slice(0,l.mustPassCount).map(x=>x.c)};
  if (l.canDeclareMeld && !v.melds[seat].length && !v.log.some(s=>s===`${['South','West','North','East'][seat]} melds 0`)) return {type:'declare_meld',seat,cards:v.hand};
  if (l.canConfirmMeld) return {type:'confirm_meld',seat};
  return {type:'play_card',seat,card:pick(l.playableCards)};
}
export function arena(n: number, budgetMs=0, prefix='arena', config?: Partial<BotConfig>) {
  let wins=0, decisions=0, elapsed=0, positions=0, made=0, hands=0;
  const started=performance.now();
  for (let i=0;i<n;i++) {
    let state=newGame(`${prefix}:${i}`);
    const rng=random(`${prefix}:random:${i}`);
    const botParity=i%2;
    for (let step=0;state.phase!=='game_over';step++) {
      if (step>15000) throw new Error(`Game did not finish: ${i}`);
      const seat=(state.phase==='melding'?state.players.find(p=>!p.meldConfirmed)!.seat:state.turn??0) as SeatIndex;
      const v=viewFor(state,seat);
      const start=performance.now();
      const action=seat%2===botParity?chooseAction(v,{seed:`${i}:${state.rev}`,budgetMs,config}):randomAction(v,rng);
      if (seat%2===botParity) { decisions++; elapsed+=performance.now()-start; }
      const priorHands=state.history.length;
      state=applyAction(state,action); positions++;
      if (state.history.length>priorHands) { hands++; if (!state.history.at(-1)!.wentSet && state.history.at(-1)!.shotMade !== false) made++; }
    }
    if (state.winner===(botParity===0?'red':'blue')) wins++;
  }
  return {games:n, botWins:wins, randomWins:n-wins, avgDecisionMs:elapsed/decisions, avgGameMs:(performance.now()-started)/n, avgBidMade:hands?made/hands:0, wins,winRate:wins/n,averageDecisionMs:elapsed/decisions,decisions,positions};
}

/** Paired deals isolate score-unit changes from deal and sampling variance. */
export function compareScoring(hands = 300, budgetMs = 0, prefix = 'scoring') {
  const results = (['modern', 'classic'] as const).map(scoring => {
    let sets = 0, contracts = 0, totalBid = 0, shoots = 0;
    const decisions: string[][] = [];
    for (let i = 0; i < hands; i++) {
      let state = newGame(`${prefix}:${i}`, { scoring }, (i % 4) as SeatIndex);
      const actions: string[] = [];
      while (!state.history.length) {
        if (actions.length > 1000) throw new Error(`Scoring hand did not finish: ${i}`);
        const seat = state.phase === 'melding' ? state.players.find(p => !p.meldConfirmed)!.seat : state.turn!;
        const action = chooseAction(viewFor(state, seat), { budgetMs, seed: `${prefix}:${i}:${state.rev}` });
        actions.push(JSON.stringify(action.type === 'bid' && scoring === 'classic' ? { ...action, amount: action.amount / 10 } : action));
        state = applyAction(state, action);
      }
      const record = state.history[0];
      sets += Number(record.wentSet);
      shoots += Number(record.shotMade !== undefined);
      contracts += Number(record.shotMade === undefined);
      totalBid += record.bid;
      decisions.push(actions);
    }
    return { scoring, hands, contracts, shoots, sets, setRate: sets / hands, meanBid: totalBid / hands, decisions };
  });
  const [modern, classic] = results;
  const mismatchedHands = modern.decisions.reduce((n, actions, i) => n + Number(JSON.stringify(actions) !== JSON.stringify(classic.decisions[i])), 0);
  // Keep the public result small enough for CLI and admin diagnostics.
  return { modern: { ...modern, decisions: undefined }, classic: { ...classic, decisions: undefined }, mismatchedHands };
}

export type Policy = (view: PlayerView, options: { budgetMs?: number; seed?: string }) => Action;
/**
 * Paired head-to-head between two bot policies. Every deal is played twice with the teams
 * swapped, and both policies get the same sampling seeds, so deal luck cancels out.
 * `partnerRaises` counts bids over a partner's high bid after both opponents had passed.
 */
export function duel(n: number, a: Policy, b: Policy, budgetMs = 0, prefix = 'duel') {
  const side = () => ({ wins: 0, points: 0, contracts: 0, made: 0, bidTotal: 0, partnerRaises: 0 });
  const stats = { a: side(), b: side() };
  let hands = 0;
  for (let i = 0; i < n; i++) for (const aParity of [0, 1]) {
    let state = newGame(`${prefix}:${i}`);
    const who = (seat: SeatIndex) => seat % 2 === aParity ? stats.a : stats.b;
    for (let step = 0; state.phase !== 'game_over'; step++) {
      if (step > 15000) throw new Error(`Duel game did not finish: ${i}`);
      const seat = (state.phase === 'melding' ? state.players.find(p => !p.meldConfirmed)!.seat : state.turn ?? 0) as SeatIndex;
      const policy = seat % 2 === aParity ? a : b;
      const action = policy(viewFor(state, seat), { budgetMs, seed: `${prefix}:${i}:${state.rev}` });
      if (action.type === 'bid' && state.highBid?.seat === (seat + 2) % 4
        && [1, 3].every(d => state.bids.some(x => x.seat === (seat + d) % 4 && x.amount === null))) who(seat).partnerRaises++;
      const priorHands = state.history.length;
      state = applyAction(state, action);
      if (state.history.length > priorHands) {
        const record = state.history.at(-1)!;
        hands++;
        const bidder = who(record.bidder);
        bidder.contracts++; bidder.bidTotal += record.bid;
        if (!record.wentSet && record.shotMade !== false) bidder.made++;
      }
    }
    const aTeam = aParity === 0 ? 'red' : 'blue', bTeam = aParity === 0 ? 'blue' : 'red';
    if (state.winner === aTeam) stats.a.wins++; else stats.b.wins++;
    stats.a.points += state.score[aTeam]; stats.b.points += state.score[bTeam];
  }
  const games = 2 * n;
  const summary = (s: ReturnType<typeof side>) => ({ wins: s.wins, winRate: s.wins / games, meanFinalScore: s.points / games,
    contracts: s.contracts, madeRate: s.contracts ? s.made / s.contracts : 0, meanBid: s.contracts ? s.bidTotal / s.contracts : 0, partnerRaises: s.partnerRaises });
  return { games, hands, a: summary(stats.a), b: summary(stats.b), meanScoreDiff: (stats.a.points - stats.b.points) / games };
}
