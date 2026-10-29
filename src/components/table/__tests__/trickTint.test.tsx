// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { HandRecap } from '@/engine/types';
import { TrickReview } from '../TrickReview';

const tricks: HandRecap['tricks'] = [{
  index: 1, leader: 0, winner: 1, counters: 2,
  plays: [{ seat: 0, card: 'AH0' }, { seat: 1, card: '9S0' }, { seat: 2, card: 'KH0' }, { seat: 3, card: 'QH1' }],
}];

beforeEach(() => {
  window.matchMedia ??= (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
});
afterEach(() => { cleanup(); window.localStorage.clear(); });

function washed(container: HTMLElement) {
  return [...container.querySelectorAll('svg[data-card]')]
    .filter(svg => svg.querySelector('rect')?.getAttribute('fill') === 'var(--chalk-trump)')
    .map(svg => svg.getAttribute('data-card'));
}

it('washes the trump played into a reviewed trick when the trump tint is on', () => {
  const { container } = render(<TrickReview tricks={tricks} trump="S" seat={0} nameOf={s => `Seat ${s}`} />);
  expect(washed(container)).toEqual(['9S0']);
});

it('leaves every card plain with the trump tint off', () => {
  window.localStorage.setItem('meld.cards', JSON.stringify({ v: 2, trumpTint: false }));
  const { container } = render(<TrickReview tricks={tricks} trump="S" seat={0} nameOf={s => `Seat ${s}`} />);
  expect(washed(container)).toEqual([]);
});
