// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RulesForm } from '../RulesForm';
import { useRulesPref } from '../useRulesPref';
import type { RulesConfig } from '@/engine';

afterEach(() => { cleanup(); localStorage.clear(); });

it.each(['game', 'points'])('shows one labelled shooting select for stored %s preferences', shoot => {
  const change = vi.fn();
  render(<RulesForm value={{ shoot, shootPoints: 100, scoring: 'modern' } as unknown as RulesConfig} onChange={change} />);
  const select = screen.getByRole('combobox', { name: 'Shooting the moon' }) as HTMLSelectElement;
  expect(select.value).toBe('on');
  expect(screen.queryByText('Shoot is worth')).toBeNull();
  fireEvent.change(select, { target: { value: 'off' } });
  expect(change.mock.calls[0][0].shoot).toBe('off');
  expect(change.mock.calls[0][0]).not.toHaveProperty('shootPoints');
});

it.each(['profile', 'browser'])('normalizes stored %s rules before dealing without an edit', source => {
  const saved = { scoring: 'modern', shoot: 'points', shootPoints: 100 } as unknown as RulesConfig;
  if (source === 'browser') localStorage.setItem('meld.rules', JSON.stringify(saved));
  function Saved() {
    const { rules } = useRulesPref(source === 'profile' ? saved : undefined);
    return <output>{JSON.stringify(rules)}</output>;
  }
  render(<Saved />);
  const rules = JSON.parse(screen.getByRole('status').textContent!);
  expect(rules.shoot).toBe('on');
  expect(rules).not.toHaveProperty('shootPoints');
});

it.each([[undefined, 'on'], [{ scoring: 'modern', shoot: 'off' }, 'off']] as const)('starts a new table from %j with shooting %s', (saved, shoot) => {
  function Fresh() {
    const { rules } = useRulesPref(saved as RulesConfig | undefined);
    return <output>{JSON.stringify(rules)}</output>;
  }
  render(<Fresh />);
  expect(JSON.parse(screen.getByRole('status').textContent!).shoot).toBe(shoot);
});
