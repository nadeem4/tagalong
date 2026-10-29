/**
 * Tests for ApprovedReport, the host of the "Approved for you" card: it shows on whatever
 * the panel is showing, and hides a panel that came up only for it once the hold ends.
 */

import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { APPROVED_HOLD_MS, ApprovedReport } from './approved-card';
import { HostBridgeProvider } from './host-bridge';
import { createFakeHostBridge } from './test-support/fake-host-bridge';

const approved = {
  tool: 'claude_code:Edit file',
  text: 'Edit a.ts',
  preference: 'Edits in repo are fine',
};

function setup() {
  const bridge = createFakeHostBridge();
  const onHide = vi.fn();
  render(
    <HostBridgeProvider bridge={bridge}>
      <ApprovedReport onHide={onHide} />
    </HostBridgeProvider>,
  );
  return { bridge, onHide };
}

describe('ApprovedReport', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the card with the preference sentence and starts no turn', () => {
    const { bridge } = setup();
    act(() => bridge.emitApproved(approved));
    const card = screen.getByRole('status', { name: 'Approved for you' });
    expect(card).toHaveTextContent('Approved for you: Edit a.ts');
    expect(card).toHaveTextContent("per 'Edits in repo are fine'");
    expect(bridge.asks).toEqual([]);
  });

  it('fades away on its own and leaves a panel that was already showing', () => {
    vi.useFakeTimers();
    const { bridge, onHide } = setup();
    act(() => bridge.emitApproved({ ...approved, cameUp: false }));
    act(() => {
      vi.advanceTimersByTime(APPROVED_HOLD_MS + 300);
    });
    expect(screen.queryByRole('status', { name: 'Approved for you' })).toBeNull();
    expect(onHide).not.toHaveBeenCalled();
  });

  it('hides a panel that came up only for the card, once the hold ends', () => {
    vi.useFakeTimers();
    const { bridge, onHide } = setup();
    act(() => bridge.emitApproved({ ...approved, cameUp: true }));
    act(() => {
      vi.advanceTimersByTime(APPROVED_HOLD_MS - 1);
    });
    expect(onHide).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(onHide).toHaveBeenCalledTimes(1);
  });
});
