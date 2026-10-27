import { describe, expect, it } from 'vitest';
import { applyAction, viewFor } from '../game';
import { buildScenario, checkState, resolveCards, stackDeal } from '../scenario';
import { PRESETS } from '../scenarios';
import { newGame } from '../game';
import { buildDeck, type CardId } from '..';
import { fuzz, fuzzRules, leakedCards } from '../fuzz';

describe('scenario builder', () => {
  it('resolves short names to free copies and refuses a third copy', () => {
    const free = new Set(buildDeck());
    expect(resolveCards(['AS', '10h', 'A♠'], free)).toEqual(['AS0', 'TH0', 'AS1']);
    expect(() => resolveCards(['AS'], free)).toThrow(/No AS left/);
  });

  it('stacks hands and completes them from the rest of the deck', () => {
    const state = stackDeal(newGame('x'), { 0: ['AS', 'AS', 'TS'] });
    expect(state.players[0].hand.slice(0, 3)).toEqual(['AS0', 'AS1', 'TS0']);
    expect(state.players.every(p => p.hand.length === 12)).toBe(true);
    expect(checkState(state)).toEqual([]);
  });

  it('replays to the same state from its base', () => {
    const s = buildScenario({ bidder: 2, bid: 30, to: 'playing', tricks: 4, turn: 1 });
    expect(s.actions.reduce(applyAction, s.base)).toEqual(s.state);
    expect(s.state.tricksTaken.red.length + s.state.tricksTaken.blue.length).toBe(4);
    expect(s.state.turn).toBe(1);
  });

  it('gives the dealer a contract above the minimum by letting someone open first', () => {
    const s = buildScenario({ dealer: 0, bidder: 0, bid: 40, to: 'declaring_trump' });
    expect(s.state.bidder).toBe(0);
    expect(s.state.highBid?.amount).toBe(40);
  });

  it('synthesises history that adds up to the requested score', () => {
    const s = buildScenario({ handNumber: 6, score: { red: 121, blue: -9 } });
    expect(s.state.history).toHaveLength(5);
    expect(checkState(s.state)).toEqual([]);
  });

  it('reports broken states in plain words', () => {
    const s = structuredClone(buildScenario({}).state);
    s.players[0].hand.push(s.players[1].hand.pop() as CardId, 'AS0');
    expect(checkState(s).join('\n')).toMatch(/Duplicated cards: AS0/);
  });
});

describe('presets', () => {
  it.each(PRESETS.map(p => [p.id, p] as const))('%s builds cleanly', (_id, preset) => {
    const s = buildScenario(preset.spec);
    expect(s.notes).toEqual([]);
    expect(checkState(s.state)).toEqual([]);
    const target = preset.spec.to ?? 'bidding';
    expect(s.state.phase === target || (target === 'game_over' && s.state.phase === 'game_over')).toBe(true);
  });

  it('includes modern play and classic counting examples', () => {
    expect(buildScenario(PRESETS.find(p => p.id === 'play-lead')!.spec).state.rules.scoring).toBe('modern');
    expect(buildScenario(PRESETS.find(p => p.id === 'rules-classic')!.spec).state.rules.scoring).toBe('classic');
  });

  const constraint = (id: string) => viewFor(buildScenario(PRESETS.find(p => p.id === id)!.spec).state, 0).legal.playConstraint?.reason;
  it('forced-play presets force the play they name', () => {
    expect(constraint('play-must-trump')).toBe('must_trump');
    expect(constraint('play-must-head')).toBe('must_head');
    expect(constraint('play-must-overtrump')).toBe('must_overtrump');
  });

  it('outcome presets land the outcome they name', () => {
    const last = (id: string) => buildScenario(PRESETS.find(p => p.id === id)!.spec).state;
    expect(last('hand-set').history.at(-1)?.wentSet).toBe(true);
    expect(last('hand-meld-lost').history.at(-1)?.breakdown.blue).toMatchObject({ meldSaved: 0 });
    expect(last('hand-meld-lost').history.at(-1)?.meld.blue).toBeGreaterThan(0);
    expect(last('hand-shoot-made').history.at(-1)?.shotMade).toBe(true);
    expect(last('hand-shoot-missed').history.at(-1)?.shotMade).toBe(false);
    expect(last('game-won').winner).toBe('red');
    expect(last('game-lost').winner).toBe('blue');
    expect(viewFor(last('bid-stuck'), 0).legal).toMatchObject({ canBid: false, canPassBid: true });
    expect(viewFor(last('bid-after-shoot'), 0).legal).toMatchObject({ canBid: false, canShoot: false });
  });
});

describe('fuzz', () => {
  it('covers both scales without mixing old-style counting into modern games', () => {
    const rules = Array.from({ length: 128 }, (_, n) => fuzzRules(n));
    expect(new Set(rules.map(rule => rule.scoring))).toEqual(new Set(['modern', 'classic']));
    for (const rule of rules) {
      if (rule.scoring === 'modern') expect(rule.counting).toBe('tens');
      for (const key of ['target', 'minBid', 'bidStep', 'lastTrickBonus', 'counterValue'] as const) {
        if (rule[key] !== undefined) expect(Number.isInteger(rule[key])).toBe(true);
      }
    }
  });
  it('plays random-rules games with bots and no broken invariants', () => {
    const result = fuzz(3, 'vitest');
    expect(result.failures.map(f => `${f.seed}: ${f.error}`)).toEqual([]);
  }, 30000);
});

describe('privacy', () => {
  it.each(PRESETS.map(p => [p.id, p] as const))('%s shows no seat a card it should not see', (_id, preset) => {
    const { base, actions } = buildScenario(preset.spec);
    let state = base;
    for (const action of [null, ...actions]) {
      if (action) state = applyAction(state, action);
      for (const seat of [0, 1, 2, 3] as const) expect(leakedCards(state, seat)).toEqual([]);
    }
  });

  it('notices a hidden card in a view', () => {
    const { state } = buildScenario({});
    const hidden = state.players[1].hand[0];
    // The log is part of every view, so a card id written there would reach South.
    const leaky = { ...state, log: [...state.log, hidden] };
    expect(leakedCards(leaky, 0)).toEqual([hidden]);
  });
});
