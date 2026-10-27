import { DEFAULT_SETTINGS, type BotConfig } from '../../lib/settings';
import { legalPlays, trickWinner } from '../rules';
import type { CardId, PlayerView, SeatIndex, Suit, Trick } from '../types';
import { sampleDeal } from './knowledge';
import { points, random, strength, suitOf, team } from './shared';

/** The policy sees its own hand and public remaining ranks, never another seat's hand. */
export function heuristic(hand: CardId[], legal: CardId[], trick: Trick, trump: Suit, seat: SeatIndex, bidder: SeatIndex | null, remaining: CardId[], view: PlayerView, config: BotConfig = DEFAULT_SETTINGS.bots): CardId {
  const cheap = (a: CardId,b: CardId) => strength(a)-strength(b) || a.localeCompare(b);
  if (!trick.plays.length) {
    const boss = legal.filter(c => !remaining.some(r => suitOf(r) === suitOf(c) && strength(r) > strength(c)));
    const pull = view.sittingOut != null && seat === bidder || team(seat) === (bidder === null ? '' : team(bidder)) && hand.filter(c => suitOf(c) === trump).length >= config.pullTrumpMin;
    return [...(boss.length ? boss : legal)].sort((a,b) => (pull ? Number(suitOf(b) === trump)-Number(suitOf(a) === trump) : 0) || strength(b)-strength(a) || cheap(a,b))[0];
  }
  const winner = trickWinner(trick, trump);
  const winning = legal.filter(card => trickWinner({ ...trick, plays: [...trick.plays, { seat, card }] }, trump) === seat);
  if (team(winner) !== team(seat) && winning.length) return [...winning].sort(cheap)[0];
  if (team(winner) === team(seat)) {
    const winningCard = trick.plays.find(p => p.seat === winner)!.card;
    const safe = trick.plays.length === (view.sittingOut != null ? 2 : 3) || !remaining.some(c => suitOf(c) === suitOf(winningCard) && strength(c) > strength(winningCard)) && suitOf(winningCard) === trump;
    if (safe && config.smearWillingness > 0) return [...legal].sort((a,b) =>
      config.smearWillingness * (points(b,view.rules)-points(a,view.rules)) - (1-config.smearWillingness) * (strength(b)-strength(a)) * view.rules.counterValue || cheap(a,b))[0];
  }
  if (winning.length && trick.plays.some(p => points(p.card,view.rules)>0)) return [...winning].sort(cheap)[0];
  return [...legal].sort((a,b) => points(a,view.rules)-points(b,view.rules) || cheap(a,b))[0];
}
function playout(view: PlayerView, deal: CardId[][], first: CardId, config: BotConfig): number {
  const hands = deal.map(h => [...h]);
  const solo = view.sittingOut != null;
  if (solo) hands[view.sittingOut!] = [];
  const trickSize = solo ? 3 : 4;
  let trick: Trick = { ...view.currentTrick!, plays: [...view.currentTrick!.plays] };
  let seat = view.seat;
  const totals = { red: 0, blue: 0 };
  const counts = { ...view.trickCounts };
  // Completed tricks are public; current trick is counted only when it finishes.
  const completed = view.playedCards.length - trick.plays.length;
  for (let i=0;i<completed;i+=trickSize) {
    const plays=view.playedCards.slice(i,i+trickSize);
    totals[team(trickWinner({ leader: plays[0].seat, plays, winner:null },view.trump!))] += plays.reduce((n,p)=>n+points(p.card,view.rules),0);
  }
  let card = first;
  while (hands.some(h => h.length)) {
    hands[seat].splice(hands[seat].indexOf(card),1);
    trick.plays.push({ seat, card });
    if (trick.plays.length === trickSize) {
      seat = trickWinner(trick, view.trump!);
      totals[team(seat)] += trick.plays.reduce((n,p)=>n+points(p.card,view.rules),0);
      counts[team(seat)]++;
      if (solo && seat !== view.bidder) return team(view.seat) === team(view.bidder!) ? -view.rules.target : view.rules.target;
      if (!hands.some(h=>h.length)) totals[team(seat)] += view.rules.lastTrickBonus;
      trick = { leader:seat, plays:[], winner:null };
    } else {
      seat = ((seat+1)%4) as SeatIndex;
      if (seat === view.sittingOut) seat = ((seat+1)%4) as SeatIndex;
    }
    if (!hands.some(h=>h.length)) break;
    const remaining=hands.flat();
    card=heuristic(hands[seat],legalPlays(hands[seat],trick,view.trump!),trick,view.trump!,seat,view.bidder,remaining,view,config);
  }
  if (solo) return team(view.seat) === team(view.bidder!) ? view.rules.target : -view.rules.target;
  const meld = { red:0, blue:0 };
  for (const s of [0,1,2,3] as SeatIndex[]) meld[team(s)] += view.melds[s].reduce((n,m)=>n+m.points,0);
  for (const t of ['red','blue'] as const) if (!view.rules.mustTakeTrickToSaveMeld || counts[t]) totals[t] += meld[t];
  const bidding=team(view.bidder!);
  if (view.highBid?.shoot) {
    const made=counts[bidding]===12;
    totals[bidding]=made?view.rules.target:-view.rules.target;
  } else if (totals[bidding] < view.highBid!.amount!) totals[bidding]=-view.highBid!.amount!;
  return team(view.seat)==='red'?totals.red-totals.blue:totals.blue-totals.red;
}
export function choosePlay(view: PlayerView, options: { budgetMs?: number; seed?: string; config?: Partial<BotConfig> }) {
  const config = { ...DEFAULT_SETTINGS.bots, ...options.config };
  const legal=view.legal.playableCards;
  if (legal.length===1) return legal[0];
  const gone=new Set(view.playedCards.map(p=>p.card));
  const fallback=heuristic(view.hand,legal,view.currentTrick!,view.trump!,view.seat,view.bidder,
    ['S','H','D','C'].flatMap(s=>[...'ATKQJ9'].flatMap(r=>[0,1].map(c=>`${r}${s}${c}` as CardId))).filter(c=>!gone.has(c)),view,config);
  const budget=options.budgetMs??config.budgetMs;
  if (budget<2) return fallback;
  const rng=random(options.seed??`${view.handNumber}:${view.rev}:${view.seat}`);
  const totals=legal.map(()=>0);
  // Fixed work units for seeded calls make replay independent of CPU speed.
  const samples=Math.min(config.samples,Math.max(1,Math.floor(budget*2/3)));
  const start=performance.now();
  let n=0;
  for (;n<samples;n++) {
    if (options.seed === undefined && n>0 && performance.now()-start>=budget) break;
    const deal=sampleDeal(view,rng);
    if (!deal) break;
    legal.forEach((c,i)=> { totals[i]+=playout(view,deal,c,config); });
  }
  if (!n) return fallback;
  return legal.reduce((best,c,i)=>totals[i]>totals[legal.indexOf(best)]?c:best,fallback);
}
