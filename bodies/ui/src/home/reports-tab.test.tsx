/**
 * Tests for ReportsTab: one collapsed row per part, the report fetched once on first expand,
 * rendered as safe Markdown, with loading, failure-and-retry and no-report states.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HostBridgeProvider } from '../host-bridge';
import { createFakeHostBridge, type FakeHostBridge } from '../test-support/fake-host-bridge';
import type { PartView } from './job-activity-state';
import { ReportsTab } from './reports-tab';

const PARTS: PartView[] = [
  {
    id: 'p1',
    expert: 'Claude Code',
    state: 'done',
    startedAt: '2026-11-02T10:00:00Z',
    endedAt: '2026-11-02T10:02:05Z',
  },
  {
    id: 'p2',
    expert: 'Gemini',
    state: 'done',
    startedAt: '2026-11-02T10:03:00Z',
    endedAt: '2026-11-02T10:04:00Z',
  },
];

function renderTab(bridge: FakeHostBridge, parts = PARTS) {
  render(
    <HostBridgeProvider bridge={bridge}>
      <ReportsTab job="j1" parts={parts} now={Date.now()} />
    </HostBridgeProvider>,
  );
}

describe('ReportsTab', () => {
  it('lists one collapsed report per part without fetching', () => {
    const bridge = createFakeHostBridge();
    renderTab(bridge);
    const heads = screen.getAllByRole('button', { expanded: false });
    expect(heads).toHaveLength(2);
    expect(heads[0]).toHaveTextContent('Claude Code');
    expect(heads[1]).toHaveTextContent('Gemini');
    expect(bridge.reportCalls).toEqual([]);
  });

  it('expanding fetches once and renders markdown safely', async () => {
    const bridge = createFakeHostBridge({
      reports: { 'j1/p1': '## Summary\n\n<script>x</script> and [bad](javascript:alert(1))' },
    });
    renderTab(bridge);
    const head = screen.getByRole('button', { name: /Claude Code/ });
    fireEvent.click(head);
    expect(await screen.findByRole('heading', { name: 'Summary' })).toBeInTheDocument();
    expect(document.querySelector('script')).toBeNull();
    expect(document.querySelector('a')).toBeNull();
    fireEvent.click(head);
    fireEvent.click(head);
    expect(bridge.reportCalls).toEqual([['j1', 'p1']]);
  });

  it('failed fetch shows a retry', async () => {
    const bridge = createFakeHostBridge({ reports: { 'j1/p1': 'fine now' } });
    const real = bridge.jobReport.bind(bridge);
    let fail = true;
    bridge.jobReport = (job, part) =>
      fail ? Promise.reject(new Error('brain down')) : real(job, part);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderTab(bridge);
    fireEvent.click(screen.getByRole('button', { name: /Claude Code/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not read/);
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('fine now')).toBeInTheDocument();
    errors.mockRestore();
  });

  it('says plainly when a part has no report', async () => {
    renderTab(createFakeHostBridge());
    fireEvent.click(screen.getByRole('button', { name: /Gemini/ }));
    await waitFor(() =>
      expect(screen.getByText('This part has not written a report.')).toBeInTheDocument(),
    );
  });

  it('has an empty state when no part exists', () => {
    renderTab(createFakeHostBridge(), []);
    expect(screen.getByText(/No expert has worked/)).toBeInTheDocument();
  });
});
