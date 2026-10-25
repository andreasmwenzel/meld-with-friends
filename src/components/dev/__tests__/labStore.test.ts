import { describe, expect, it } from 'vitest';
import { buildScenario } from '@/engine/scenario';
import { decodeSpec, encodeSpec, parseImport } from '../labStore';

/** Reverse every object's key order, as a jsonb round trip may. */
const shuffleKeys = (v: unknown): unknown => Array.isArray(v) ? v.map(shuffleKeys)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, shuffleKeys(x)])) : v;

describe('lab import', () => {
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
