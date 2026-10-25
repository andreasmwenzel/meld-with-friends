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
