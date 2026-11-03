/**
 * Tests for OverviewTab: Scout's result as Markdown, the times, who worked on it, and the honest
 * empty state when Scout wrote no result.
 */

import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { JobActivityEntry } from '../host-bridge';
import type { PartView } from './job-activity-state';
import { OverviewTab, workers } from './overview-tab';

const PARTS: PartView[] = [
  { id: 'p1', expert: 'Claude Code', state: 'done', startedAt: 'a', endedAt: 'b' },
  { id: 'p2', expert: 'Claude Code', state: 'done', startedAt: 'a', endedAt: 'b' },
];
const entry = (seq: number, source: string | null): JobActivityEntry => ({
  rev: seq,
  seq,
  at: '2026-11-02T10:00:00Z',
  kind: 'tool',
  text: 't',
  status: 'done',
  step: null,
  exit: null,
  part: source ? 'scout' : 'p1',
  source,
});

function renderTab(extra: Partial<Parameters<typeof OverviewTab>[0]> = {}) {
  const onReports = vi.fn();
  render(
    <OverviewTab
      state="done"
      result="All **shipped**."
      parts={PARTS}
      entries={[entry(1, 'app:files'), entry(2, 'scout:remember'), entry(3, 'app:files')]}
      startedAt="2026-11-02T10:00:00Z"
      endedAt="2026-11-02T10:02:05Z"
      now={Date.parse('2026-11-02T11:00:00Z')}
      onReports={onReports}
      {...extra}
    />,
  );
  return onReports;
}

describe('OverviewTab', () => {
  it('shows result, times and who worked', () => {
    renderTab();
    expect(screen.getByRole('heading', { name: 'Scout’s result' })).toBeInTheDocument();
    expect(screen.getByText('shipped').tagName).toBe('STRONG');
    expect(screen.getByText('Ran for').nextSibling).toHaveTextContent('2m 5s');
    const who = screen.getByRole('list');
    expect(
      within(who)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Claude Code', 'files (app)', 'remember (Scout tool)']);
  });

  it('without a result shows status and a pointer, no placeholder prose', () => {
    const onReports = renderTab({ result: null });
    expect(screen.queryByRole('heading', { name: 'Scout’s result' })).toBeNull();
    expect(screen.getByText(/Finished\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'See the reports' }));
    expect(onReports).toHaveBeenCalled();
  });

  it('a running job shows no finish time and a live duration', () => {
    renderTab({ state: 'running', endedAt: null, result: null });
    expect(screen.getByText('Finished').nextSibling).toHaveTextContent('—');
    expect(screen.getByText('Ran for').nextSibling).toHaveTextContent('60m 0s');
  });

  it('ran for never goes negative', () => {
    renderTab({ startedAt: '2026-11-02T10:05:00Z', endedAt: '2026-11-02T10:00:00Z' });
    expect(screen.getByText('Ran for').nextSibling).toHaveTextContent('0s');
  });

  it('workers lists each app and tool once', () => {
    expect(workers([entry(1, 'app:a'), entry(2, 'app:a'), entry(3, 'scout:x')])).toEqual({
      apps: ['a'],
      tools: ['x'],
    });
  });
});
