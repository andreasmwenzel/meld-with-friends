import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { newPracticeGame, viewFor } from '@/engine';
import { ResultSheet } from '@/components/table/Result';

function result(local?: boolean, host: string | null = 'the host') {
  const view = viewFor({ ...newPracticeGame(), phase: 'hand_over' }, 0);
  return renderToStaticMarkup(createElement(ResultSheet, {
    view, local, nameOf: () => 'You', host, busy: false,
    onNext: vi.fn(), onRematch: vi.fn(),
    readyInfo: { me: false, all: false, readyNames: [], waitingNames: ['You', 'Margaret', 'Walt', 'June'], post: vi.fn() },
    which: 'atPlay', setWhich: vi.fn(), peek: false, setPeek: vi.fn(),
    countdown: { handKey: 'practice-1', blocked: false, onNext: vi.fn() },
  }));
}

describe('practice hand continuation', () => {
  it('offers a local deal without fictional readiness or a table countdown', () => {
    const html = result(true);
    expect(html).toContain('Deal the next hand');
    expect(html).not.toContain('Ready for the next hand');
    expect(html).not.toContain('Still looking:');
    expect(html).not.toContain('countdown');
  });

  it('never offers a table countdown even when the learner is the host', () => {
    const html = result(true, null);
    expect(html).toContain('Deal the next hand');
    expect(html).not.toContain('countdown');
  });

  it('keeps multiplayer readiness on the default path', () => {
    const html = result();
    expect(html).toContain('Ready for the next hand');
    expect(html).toContain('Still looking:');
  });
});
