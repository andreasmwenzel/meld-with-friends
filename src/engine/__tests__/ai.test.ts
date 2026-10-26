import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { chooseAction } from '../ai';
import { bestTrump, projectedValue, safetyMargin } from '../ai/bid';
import { knowledge, sampleDeal } from '../ai/knowledge';
import { random } from '../ai/shared';
import { applyAction, newGame, viewFor } from '../game';
import { arena } from './arena';
import type { SeatIndex } from '../types';

describe('public-information computer players',()=>{
  it('plays thousands of seeded legal positions to game over, with constrained deals',()=>{
    let positions=0;
    for(let i=0;i<12;i++) {
      let state=newGame(`fuzz:${i}`,{scoring:'classic',target:500, counting:i%2?'classic':'tens',passCount:i%3?4:0});
      for(let step=0;state.phase!=='game_over';step++) {
        expect(step).toBeLessThan(10000);
        const seat=(state.phase==='melding'?state.players.find(p=>!p.meldConfirmed)!.seat:state.turn??0) as SeatIndex;
        const v=viewFor(state,seat);
        const a=chooseAction(v,{budgetMs:0,seed:`fuzz:${i}:${step}`});
        expect(chooseAction(v,{budgetMs:0,seed:`fuzz:${i}:${step}`})).toEqual(a);
        if(a.type==='bid') expect(a.amount).toBeLessThanOrEqual(projectedValue(v,bestTrump(v))-safetyMargin);
        if(v.phase==='playing' && positions%13===0) {
          const deal=sampleDeal(v,random(`sample:${positions}`));
          expect(deal).not.toBeNull();
          const k=knowledge(v);
          for(const s of [0,1,2,3]) {
            expect(deal![s]).toHaveLength(v.handCounts[s]);
            for(const c of deal![s]) {
              expect(k.gone.has(c)).toBe(false);
              if(s!==seat) { expect(v.hand).not.toContain(c); expect(k.voids[s].has(c[1] as 'S')).toBe(false); }
            }
          }
          expect(new Set(deal!.flat()).size).toBe(deal!.flat().length);
        }
        state=applyAction(state,a); positions++;
      }
    }
    expect(positions).toBeGreaterThan(1900);
  },30000);
  it('keeps no-passing contracts within a measured set-rate bound',()=>{
    // The 400-hand baseline went set 72.25% of the time without passing,
    // versus 26.5% with four-card passing. Leave margin for this smaller sample.
    const hands = 80;
    let sets = 0;
    for (let i = 0; i < hands; i++) {
      let state = newGame(`pass-value:${i}`, { scoring: 'classic', minBid: 150, passCount: 0, counting: 'tens', shoot: 'off' }, (i % 4) as SeatIndex);
      while (!state.history.length) {
        const seat = state.phase === 'melding'
          ? state.players.find(p => !p.meldConfirmed)!.seat
          : state.turn!;
        state = applyAction(state, chooseAction(viewFor(state, seat), { budgetMs: 0, seed: `${state.seed}:${state.rev}` }));
      }
      sets += Number(state.history[0].wentSet);
    }
    expect(sets / hands).toBeLessThan(.4);
  });
  it('records public plays in order and infers failed follow and failed trump',()=>{
    let state=newGame('void-example');
    while(state.phase!=='playing') {
      const seat=(state.phase==='melding'?state.players.find(p=>!p.meldConfirmed)!.seat:state.turn!) as SeatIndex;
      state=applyAction(state,chooseAction(viewFor(state,seat),{budgetMs:0}));
    }
    const v=viewFor(state,state.turn!);
    v.trump='H';
    v.playedCards=[{seat:0,card:'AS0'},{seat:1,card:'KC0'},{seat:2,card:'AH0'},{seat:3,card:'TS0'}];
    const k=knowledge(v);
    expect(k.voids[1].has('S')).toBe(true);
    expect(k.voids[1].has('H')).toBe(true);
    expect(k.voids[2].has('S')).toBe(true);
    expect(k.voids[2].has('H')).toBe(false);
    const action=chooseAction(viewFor(state,state.turn!),{budgetMs:0});
    if(action.type!=='play_card') throw new Error('expected play');
    state=applyAction(state,action);
    for(const seat of [0,1,2,3] as SeatIndex[]) {
      const publicView=viewFor(state,seat);
      expect(publicView.playedCards).toEqual([{seat:action.seat,card:action.card}]);
      expect(publicView.revealed).toBeNull();
      expect(publicView).not.toHaveProperty('players');
    }
  });
  it('has no dependency on private engine state, I/O, or revealed hands',()=>{
    const dir=new URL('../ai/',import.meta.url);
    for(const name of readdirSync(dir).filter(n=>n.endsWith('.ts') && n !== 'arena.ts')) {
      const source=readFileSync(new URL(name,dir),'utf8');
      expect(source).not.toMatch(/GameState|\.revealed|from ['"](?:\.\.\/(?:game|index|deck)|node:|@\/server)/);
      for(const match of source.matchAll(/from ['"]([^'"]+)['"]/g)) expect(match[1]).toMatch(/^(?:\.\/[^/]+|\.\.\/(?:types|meld|rules|scoring)|\.\.\/\.\.\/lib\/settings)$/);
    }
  });
  it('uses Monte Carlo legally and deterministically with a seed',()=>{
    let state=newGame('simulation');
    while(state.phase!=='playing') {
      const seat=(state.phase==='melding'?state.players.find(p=>!p.meldConfirmed)!.seat:state.turn!) as SeatIndex;
      state=applyAction(state,chooseAction(viewFor(state,seat),{budgetMs:0}));
    }
    for(let i=0;i<48;i++) {
      const v=viewFor(state,state.turn!);
      const a=chooseAction(v,{budgetMs:3,seed:`mc:${i}`});
      expect(a).toEqual(chooseAction(v,{budgetMs:3,seed:`mc:${i}`}));
      state=applyAction(state,a);
    }
  });
  it('wins at least 80% of 50 games against random legal play',()=>{
    expect(arena(50,0).winRate).toBeGreaterThanOrEqual(.8);
  },60000);
});
