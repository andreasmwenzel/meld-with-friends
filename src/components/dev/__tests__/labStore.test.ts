import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import archived from '@/engine/__tests__/fixtures/legacy-shoot.json';
import continuation from '@/engine/__tests__/fixtures/legacy-shoot-continuation.json';
import type { Action, GameState } from '@/engine/types';
import { applyAction } from '@/engine';
import { buildScenario } from '@/engine/scenario';
import { decodeSpec, encodeSpec, LabStore, parseImport } from '../labStore';

/** Reverse every object's key order, as a jsonb round trip may. */
const shuffleKeys = (v: unknown): unknown => Array.isArray(v) ? v.map(shuffleKeys)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, shuffleKeys(x)])) : v;

describe('lab import', () => {
  it('keeps the timeline after continuing an old points game during an ordinary hand', () => {
    const before = continuation.final as unknown as GameState;
    const action: Action = { type: 'bid', seat: before.turn!, amount: before.rules.minBid };
    const state = applyAction(before, action);
    const actions = [...continuation.actions as Action[], action];
    const parsed = parseImport({ state: shuffleKeys(state), actions });
    expect(parsed.note).toMatch(/Rebuilt from seed/);
    expect(parsed.actions).toEqual(actions);
    const store = new LabStore();
    store.load(parsed.base, parsed.actions, { kind: 'import', name: 'continued-legacy' }, { running: false });
    expect(store.get().error).toBeNull();
    expect(store.state.score).toEqual(state.score);
    store.goto(actions.length - 1);
    expect(store.state).toMatchObject({ phase: 'bidding', handNumber: 2, highBid: null });
    store.redo();
    expect(store.state.highBid).toEqual(state.highBid);
  });

  it('rebuilds a production game from its seed even when jsonb reordered the keys', () => {
    const built = buildScenario({ dealer: 2, bidder: 3, bid: 260, to: 'playing', tricks: 5 });
    const parsed = parseImport({ state: shuffleKeys(built.state), actions: built.actions });
    expect(parsed.note).toMatch(/Rebuilt from seed/);
    expect(parsed.actions).toHaveLength(built.actions.length);
  });

  it('loads a bare state when there is no action log', () => {
    const { state } = buildScenario({});
    expect(parseImport(state)).toMatchObject({ actions: [], note: 'Loaded the state alone' });
  });

  it('round-trips specs through URL-safe links, including suit symbols', () => {
    const spec = { hands: { 0: ['A♠', '10H'] }, to: 'melding' as const };
    expect(encodeSpec(spec)).not.toMatch(/[+/=]/);
    expect(decodeSpec(encodeSpec(spec))).toEqual(spec);
  });
});

describe.each([4, 0])('legacy lab timelines with passCount=%i', passCount => {
  const built = buildScenario({ bidder: 0, trump: 'S', rules: { shoot: 'on', passCount }, to: 'melding', confirmed: [0] });
  const actions = built.actions.filter(action => action.type !== 'decline_shoot');
  const meldIndex = actions.findIndex(action => action.type === 'declare_meld');

  beforeEach(() => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value); },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('imports a pre-phase pass-to-meld log with an explicit decline', () => {
    const parsed = parseImport({ base: built.base, actions });
    const store = new LabStore();
    store.load(parsed.base, parsed.actions, { kind: 'import', name: 'legacy' });
    expect(store.get().error).toBeNull();
    expect(store.state).toEqual(built.state);
    expect(parsed.actions).toEqual(built.actions);
    expect(parsed.note).toBe(`${built.actions.length} actions`);
    store.goto(meldIndex);
    expect(store.state.phase).toBe('deciding_shoot');
    store.redo();
    expect(store.state.phase).toBe('melding');
  });

  it('leaves an imported terminal decision pending without a final state', () => {
    const pending = actions.slice(0, meldIndex);
    const parsed = parseImport({ base: built.base, actions: pending });
    expect(parsed.actions).toEqual(pending);
    expect(parsed.actions.reduce(applyAction, parsed.base).phase).toBe('deciding_shoot');
  });

  it.each([0, 1, 2])('restores a pre-phase timeline with %i meld actions applied', meldActions => {
    const cursor = meldIndex + meldActions;
    localStorage.setItem('meld-lab-v1', JSON.stringify({ base: built.base, actions, cursor }));
    const store = new LabStore();
    expect(store.restore()).toBe(true);
    const expandedCursor = cursor + (meldActions > 0 ? 1 : 0);
    expect(store.get().actions).toEqual(built.actions);
    expect(store.get().cursor).toBe(expandedCursor);
    expect(store.state).toEqual(built.actions.slice(0, expandedCursor).reduce(applyAction, built.base));
    store.goto(store.get().actions.length);
    expect(store.state).toEqual(built.state);
    expect(store.allStates).toHaveLength(built.actions.length + 1);
    const saved = JSON.parse(localStorage.getItem('meld-lab-v1')!);
    expect(saved.actions).toEqual(built.actions);
    const restored = new LabStore();
    expect(restored.restore()).toBe(true);
    expect(restored.state).toEqual(built.state);
  });

  it('leaves a persisted terminal decision pending without a final state', () => {
    const pending = actions.slice(0, meldIndex);
    localStorage.setItem('meld-lab-v1', JSON.stringify({ base: built.base, actions: pending, cursor: pending.length }));
    const store = new LabStore();
    expect(store.restore()).toBe(true);
    expect(store.get().actions).toEqual(pending);
    expect(store.state.phase).toBe('deciding_shoot');
  });
});

it.each(archived)('imports and navigates an archived $mode $timing shoot', fixture => {
  const parsed = parseImport({ state: fixture.final, actions: fixture.actions });
  expect(parsed.note).toMatch(/Rebuilt from seed/);
  const store = new LabStore();
  store.load(parsed.base, parsed.actions, { kind: 'import', name: 'archived-shoot' }, { running: false });
  expect(store.get().error).toBeNull();
  expect(store.state.players).toEqual(fixture.final.players);
  expect(store.state.score).toEqual(fixture.final.score);
  const shootIndex = (fixture.actions as Action[]).findIndex(action => action.type === 'shoot');
  store.goto(shootIndex + 1);
  expect(store.state.sittingOut).toBeNull();
  const rawBase = { ...parsed.base, rules: fixture.final.rules } as unknown as GameState;
  const exported = parseImport({ base: rawBase, actions: fixture.actions });
  store.load(exported.base, exported.actions, { kind: 'import', name: 'export' }, { running: false });
  expect(store.get().error).toBeNull();
  expect(store.state.score).toEqual(fixture.final.score);
});
