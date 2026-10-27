import { describe, expect, it } from 'vitest';
import { applyAction, newGame, viewFor } from '../game';
import { POINT_RULE_KEYS, resolveRules } from '../scoring';
import { DEFAULT_RULES, type RulesConfig } from '../types';

describe('scoring compatibility', () => {
  it('defaults new tables and non-point preferences to modern', () => {
    for (const patch of [undefined, null, {}, { passCount: 3 }, { counting: 'tens' as const }]) {
      expect(resolveRules(patch).scoring).toBe('modern');
      expect(resolveRules(patch).minBid).toBe(25);
    }
    expect(newGame('new').rules).toEqual(DEFAULT_RULES);
  });

  it.each(POINT_RULE_KEYS)('interprets legacy point preference %s as classic', key => {
    const classic = resolveRules({ scoring: 'classic' });
    expect(resolveRules({ [key]: classic[key] })).toEqual(classic);
  });

  it('uses classic for old counting and respects explicit scoring', () => {
    expect(resolveRules({ counting: 'classic' }).scoring).toBe('classic');
    expect(resolveRules({ scoring: 'modern', target: 200 }).minBid).toBe(25);
    expect(resolveRules({ scoring: 'classic' }).target).toBe(1500);
  });

  it('reads full stored games as classic, including views and continued meld actions', () => {
    let state = newGame('legacy', { scoring: 'classic', passCount: 0 });
    state = applyAction(state, { type: 'bid', seat: 1, amount: 250 });
    for (const seat of [2, 3, 0] as const) state = applyAction(state, { type: 'pass_bid', seat });
    state = applyAction(state, { type: 'declare_trump', seat: 1, suit: 'S' });
    state.players[0].hand = ['AS0', 'TS0', 'KS0', 'QS0', 'JS0'];
    delete (state.rules as Partial<RulesConfig>).scoring;
    expect(viewFor(state, 0).rules).toEqual(resolveRules({ scoring: 'classic', passCount: 0 }));
    const updated = applyAction(state, { type: 'declare_meld', seat: 0, cards: state.players[0].hand });
    expect(updated.players[0].meldPoints).toBe(150);
    expect(updated.rules.scoring).toBe('classic');
    expect(state.rules.scoring).toBeUndefined();
  });

  it('keeps the inferred classic scale of a legacy shoot stake preference', () => {
    expect(resolveRules({ shoot: 'points', shootPoints: 1500 })).toMatchObject({ scoring: 'classic', shoot: 'on', target: 1500 });
  });

  it('forces even empty stored rule objects to classic', () => {
    expect(resolveRules({}, true)).toEqual(resolveRules({ scoring: 'classic' }));
  });
});
