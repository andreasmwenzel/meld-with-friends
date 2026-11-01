// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { newGame, viewFor } from '@/engine/game';
import type { MotionPref } from '@/lib/cardPrefs';
import type { PlayerView } from '@/engine/types';
import { useDeal } from '../Deal';

afterEach(() => { cleanup(); sessionStorage.clear(); });
const fresh = (seed: string) => viewFor(newGame(seed), 0) as PlayerView;

it('deals a fresh hand once, and stops at once when motion is turned off', () => {
  const view = fresh('deal-a');
  const hook = renderHook(({ motion }: { motion: MotionPref }) => useDeal(view, motion, 'AAAA'), { initialProps: { motion: 'normal' } });
  expect(hook.result.current).not.toBeNull();
  hook.rerender({ motion: 'off' });
  expect(hook.result.current).toBeNull();
  hook.rerender({ motion: 'normal' });
  expect(hook.result.current).toBeNull();
});

it('does not deal a table again after a visit to another', () => {
  const a = fresh('deal-a'), b = fresh('deal-b');
  const first = renderHook(() => useDeal(a, 'normal', 'AAAA'));
  expect(first.result.current).not.toBeNull();
  first.unmount();
  const other = renderHook(() => useDeal(b, 'normal', 'BBBB'));
  expect(other.result.current).not.toBeNull();
  other.unmount();
  expect(renderHook(() => useDeal(a, 'normal', 'AAAA')).result.current).toBeNull();
});
