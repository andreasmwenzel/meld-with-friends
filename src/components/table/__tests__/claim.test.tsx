// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { applyAction, viewFor } from '@/engine/game';
import { buildScenario } from '@/engine/scenario';
import { PRESETS } from '@/engine/scenarios';
import type { Action, SeatIndex } from '@/engine/types';
import { Game } from '../Game';
import { claimTimings } from '../motion';
import type { Snapshot } from '../types';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock('@/lib/push', () => ({ usePushNotifications: () => ({ supported: false, enabled: false }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

const spec = PRESETS.find(p => p.id === 'claim-all')!.spec;
/** Each animation and the element it runs on. */
const animate = vi.fn(function (this: HTMLElement) { return { cancel: vi.fn() }; });

async function table({ seat = 0 as SeatIndex, motion = 'normal', reduced = false, available = true, sort = undefined as object | undefined } = {}) {
  let server = buildScenario(available ? spec : PRESETS.find(p => p.id === 'play-lead')!.spec).state;
  const sent: Action[] = [];
  animate.mockClear();
  HTMLElement.prototype.animate = animate as unknown as typeof HTMLElement.prototype.animate;
  localStorage.setItem('meld.cards', JSON.stringify(sort ? { v: 2, motion, sort } : { motion }));
  window.matchMedia = ((query: string) => ({ matches: query.includes('prefers-reduced-motion') ? reduced : query.includes('max-width'), media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  const me = { id: `u${seat}`, handle: 'reader', display_name: 'Reader', avatar_seed: 'reader' };
  const snap = {
    table: { id: 't', code: 'TEST', host: 'u0', status: 'playing', rules: server.rules },
    seats: [0, 1, 2, 3].map(s => ({ seat: s, user_id: `u${s}`, bot: null, profile: s === seat ? me : { display_name: ['South', 'West', 'North', 'East'][s] } })),
    offers: [], mySeat: seat, ready: [], paused: null,
  } as unknown as Snapshot;
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith('/act')) {
      const action = JSON.parse(String(init?.body)).action as Action;
      sent.push(action);
      server = applyAction(server, action);
    }
    return Response.json({ ...viewFor(server, seat), ready: [] });
  }) as typeof fetch;
  const board = () => <Game code="TEST" me={me} snap={snap} rev={server.rev} local onTableChange={() => {}} />;
  const rendered = render(board());
  await vi.waitFor(() => expect(document.querySelector('[data-hand-card]')).toBeTruthy());
  return { sent, claim: async () => {
    server = applyAction(server, { type: 'claim', seat: 0 });
    await act(async () => { rendered.rerender(board()); await new Promise(r => setTimeout(r, 50)); });
  } };
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('sends a single claim on one tap from the native keyboard-accessible button', async () => {
  const t = await table({ motion: 'off' });
  const button = screen.getByRole('button', { name: 'Claim all' });
  expect(button.getAttribute('type')).toBe('button');
  button.focus();
  await act(() => { fireEvent.click(button, { detail: 0 }); });
  await vi.waitFor(() => expect(t.sent).toEqual([{ type: 'claim', seat: 0 }]));
  expect(document.querySelector('[data-announcer]')?.textContent).toContain('You claim the rest.');
  expect(document.querySelectorAll('[data-claim-card]')).toHaveLength(36);
  await act(() => new Promise(r => setTimeout(r, claimTimings('off', 9).totalMs + 50)));
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect(screen.getByText('You claim the rest. 9 remaining tricks.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Claim all' })).toBeNull();
});

it('hides the claim button when the proof fails', async () => {
  await table({ available: false });
  expect(screen.queryByRole('button', { name: 'Claim all' })).toBeNull();
});

it.each([
  ['normal', false, 'normal', true], ['quick', false, 'quick', true],
  ['off', false, 'off', false], ['normal', true, 'off', false],
] as const)('reveals the claim to another seat with motion %s and reduced=%s', async (motion, reduced, shown, transforms) => {
  const { stepMs, sweepAt: delay, outMs: duration } = claimTimings(shown, 9);
  const t = await table({ seat: 1, motion, reduced });
  expect(screen.queryByRole('button', { name: 'Claim all' })).toBeNull();
  await t.claim();
  await vi.waitFor(() => expect(document.querySelector('[data-announcer]')?.textContent).toContain('South claims the rest.'));
  expect(document.querySelectorAll('[data-claim-card]')).toHaveLength(36);
  const calls = animate.mock.calls as unknown as [Keyframe[], KeyframeAnimationOptions][];
  const runs = calls.map(([frames, options], i) => ({ frames, options, on: animate.mock.contexts[i] as HTMLElement }));
  const seatOf = (el: HTMLElement) => el.closest('[data-hand="mine"]') ? '1' : el.closest('[data-claim-seat]')?.getAttribute('data-claim-seat');
  // South's nine cards stay on the table, face down, until each turns up in turn: never fewer cards than South holds.
  const backs = [...document.querySelectorAll<HTMLElement>('[data-claim-back]')];
  expect(backs).toHaveLength(9);
  expect(backs.every(back => seatOf(back) === '0')).toBe(true);
  expect(backs.map(back => runs.find(run => run.on === back)?.options.delay)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8].map(n => n * stepMs));
  // With motion, each back goes the moment its card stands edge-on: halfway, on a linear clock eased per half.
  // Without it, the backs fade.
  const backRuns = backs.map(back => runs.find(run => run.on === back)!);
  expect(backRuns.every(run => run.frames.length === (transforms ? 4 : 2))).toBe(true);
  // Every card sweeps to South together after the hold.
  const sweeping = runs.filter(run => run.options.delay === delay);
  expect(sweeping).toHaveLength(36);
  expect(sweeping[0].options).toMatchObject({ duration });
  // Your own hand is already face up: it does not turn over again.
  expect(runs.filter(run => seatOf(run.on) === '1' && run.options.delay !== delay)).toHaveLength(0);
  // With motion, South's cards step toward the cloth and stay there until the sweep.
  const steps = runs.filter(run => seatOf(run.on) === '0' && run.on.hasAttribute('data-claim-card') && run.options.delay !== delay);
  expect(steps.length).toBe(transforms ? 9 : 0);
  if (transforms) expect(steps.every(run => run.options.fill === 'both' && run.options.easing === 'linear'
    && run.frames[1].offset === 0.5 && String(run.frames[1].transform).includes('rotateY(90deg)')
    && String(run.frames.at(-1)!.transform).startsWith('translate('))).toBe(true);
  expect(runs.some(({ frames }) => frames.some(frame => frame.transform !== undefined))).toBe(transforms);
  expect(screen.queryByRole('dialog')).toBeNull();
  await act(() => new Promise(r => setTimeout(r, delay + duration + 50)));
  expect(screen.getByRole('dialog')).toBeTruthy();
  // The result takes focus after the reveal, and the hand's remaining cards stay reviewable.
  expect(document.activeElement?.getAttribute('role')).toBe('dialog');
  await act(() => { fireEvent.click(screen.getByRole('button', { name: 'Look at the table' })); });
  // Looking at the table after a claim shows the hands as played, as at any hand's end, not what was left at the claim.
  expect(document.querySelectorAll('[data-hand] [data-card]:not([data-card=back])')).toHaveLength(48);
  expect(document.querySelector('[data-claim]')).toBeNull();
  await act(() => { fireEvent.click(screen.getByRole('button', { name: 'Menu' })); });
  await act(() => { fireEvent.click(screen.getByRole('tab', { name: 'This hand' })); });
  expect(screen.getByText('South claimed the rest from trick 4. Remaining hands:')).toBeTruthy();
}, 10000);

it('turns the claim up from the high end however the hand is sorted', async () => {
  const t = await table({ seat: 1, sort: { suits: 'fixed', trump: 'right', ranks: 'low-first' } });
  await t.claim();
  await vi.waitFor(() => expect(document.querySelectorAll('[data-claim-back]')).toHaveLength(9));
  const calls = animate.mock.calls as unknown as [Keyframe[], KeyframeAnimationOptions][];
  const delayOf = (back: HTMLElement) => calls[animate.mock.contexts.indexOf(back)][1].delay;
  const order = [...document.querySelectorAll<HTMLElement>('[data-claim-back]')]
    .sort((a, b) => delayOf(a)! - delayOf(b)!).map(back => back.closest<HTMLElement>('[data-claim-card]')!.dataset.claimCard!.slice(0, 2));
  // Low cards and trump on the right put the fan's high end last; the reveal still starts with the top trump.
  expect(order).toEqual(['TS', 'KS', 'KS', 'QS', 'QS', 'JS', 'AC', 'AC', 'AD']);
});

it('keeps the reveal on its first deadline when the same view arrives again', async () => {
  const { renderHook } = await import('@testing-library/react');
  const { useClaimReveal } = await import('../Claim');
  const before = buildScenario(spec).state;
  const after = applyAction(before, { type: 'claim', seat: 0 });
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  try {
    const root = { current: null };
    const hook = renderHook(({ view }) => useClaimReveal(view, 'normal', root), { initialProps: { view: viewFor(before, 1) } });
    hook.rerender({ view: viewFor(after, 1) });
    expect(hook.result.current).toBe(true);
    const { totalMs } = claimTimings('normal', 9);
    act(() => { vi.advanceTimersByTime(totalMs - 500); });
    // A ready ping or a reconnect fetches the same claim again, as a new object.
    hook.rerender({ view: viewFor(after, 1) });
    act(() => { vi.advanceTimersByTime(499); });
    expect(hook.result.current).toBe(true);
    act(() => { vi.advanceTimersByTime(2); });
    expect(hook.result.current).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});
