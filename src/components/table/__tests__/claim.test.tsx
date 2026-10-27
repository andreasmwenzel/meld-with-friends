// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { applyAction, viewFor } from '@/engine/game';
import { buildScenario } from '@/engine/scenario';
import { PRESETS } from '@/engine/scenarios';
import type { Action, SeatIndex } from '@/engine/types';
import { Game } from '../Game';
import type { Snapshot } from '../types';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock('@/lib/push', () => ({ usePushNotifications: () => ({ supported: false, enabled: false }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

const spec = PRESETS.find(p => p.id === 'claim-all')!.spec;
const animate = vi.fn(() => ({ cancel: vi.fn() }));

async function table({ seat = 0 as SeatIndex, motion = 'normal', reduced = false, available = true } = {}) {
  let server = buildScenario(available ? spec : PRESETS.find(p => p.id === 'play-lead')!.spec).state;
  const sent: Action[] = [];
  animate.mockClear();
  HTMLElement.prototype.animate = animate as unknown as typeof HTMLElement.prototype.animate;
  localStorage.setItem('meld.cards', JSON.stringify({ motion }));
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
  await act(() => new Promise(r => setTimeout(r, 350)));
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect(screen.getByText('You claim the rest. 9 remaining tricks.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Claim all' })).toBeNull();
});

it('hides the claim button when the proof fails', async () => {
  await table({ available: false });
  expect(screen.queryByRole('button', { name: 'Claim all' })).toBeNull();
});

it.each([
  ['normal', false, 900, 350, true], ['quick', false, 450, 180, true],
  ['off', false, 150, 150, false], ['normal', true, 150, 150, false],
] as const)('reveals the claim to another seat with motion %s and reduced=%s', async (motion, reduced, delay, duration, transforms) => {
  const t = await table({ seat: 1, motion, reduced });
  expect(screen.queryByRole('button', { name: 'Claim all' })).toBeNull();
  await t.claim();
  await vi.waitFor(() => expect(document.querySelector('[data-announcer]')?.textContent).toContain('South claims the rest.'));
  expect(document.querySelectorAll('[data-claim-card]')).toHaveLength(36);
  expect(animate).toHaveBeenCalledTimes(72);
  const sweeps = animate.mock.calls as unknown as [Keyframe[], KeyframeAnimationOptions][];
  expect(sweeps[1][1]).toMatchObject({ delay, duration });
  expect(sweeps.some(([frames]) => frames.some(frame => frame.transform !== undefined))).toBe(transforms);
  expect(screen.queryByRole('dialog')).toBeNull();
  await act(() => new Promise(r => setTimeout(r, delay + duration + 50)));
  expect(screen.getByRole('dialog')).toBeTruthy();
  // The result takes focus after the reveal, and the hand's remaining cards stay reviewable.
  expect(document.activeElement?.getAttribute('role')).toBe('dialog');
  await act(() => { fireEvent.click(screen.getByRole('button', { name: 'Look at the table' })); });
  await act(() => { fireEvent.click(screen.getByRole('button', { name: 'Menu' })); });
  await act(() => { fireEvent.click(screen.getByRole('tab', { name: 'This hand' })); });
  expect(screen.getByText('South claimed the rest from trick 4. Remaining hands:')).toBeTruthy();
});
