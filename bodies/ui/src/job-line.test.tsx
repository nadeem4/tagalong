/** Tests for useRunningStep and JobLine: the bubble's one live line for a running job. */

import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HostBridgeProvider, type RunningStep } from './host-bridge';
import { JobLine, useRunningStep } from './job-line';
import { createFakeHostBridge } from './test-support/fake-host-bridge';

const step = (text: string, expert = 'Claude Code') => ({
  job: 'j1',
  expert,
  text,
  at: '2026-11-02T10:00:00Z',
});

afterEach(() => vi.restoreAllMocks());

describe('useRunningStep', () => {
  it('is null at first, then the first running step', async () => {
    const bridge = createFakeHostBridge({ runningSteps: [step('npm init -y'), step('older')] });
    const { result } = renderHook(() => useRunningStep(bridge));
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current?.text).toBe('npm init -y'));
  });

  it('follows job_activity and clears on a jobs change with nothing running', async () => {
    const bridge = createFakeHostBridge({ runningSteps: [step('one')] });
    const { result } = renderHook(() => useRunningStep(bridge));
    await waitFor(() => expect(result.current?.text).toBe('one'));
    bridge.running = [step('two')];
    act(() => bridge.emitChanged('job_activity'));
    await waitFor(() => expect(result.current?.text).toBe('two'));
    bridge.running = [];
    act(() => bridge.emitChanged('jobs'));
    await waitFor(() => expect(result.current).toBeNull());
  });

  it('shows nothing and logs once when the brain is offline', async () => {
    const bridge = createFakeHostBridge();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    bridge.runningSteps = () => Promise.reject(new Error('offline'));
    const { result } = renderHook(() => useRunningStep(bridge));
    await waitFor(() => expect(error).toHaveBeenCalledTimes(1));
    expect(result.current).toBeNull();
  });

  it('ignores unrelated changes', async () => {
    const bridge = createFakeHostBridge({ runningSteps: [step('one')] });
    const { result } = renderHook(() => useRunningStep(bridge));
    await waitFor(() => expect(result.current).not.toBeNull());
    const calls = bridge.runningStepCalls;
    act(() => bridge.emitChanged('settings'));
    expect(bridge.runningStepCalls).toBe(calls);
  });

  it('throttles a burst to a leading and a trailing read', async () => {
    vi.useFakeTimers();
    try {
      const bridge = createFakeHostBridge({ runningSteps: [step('one')] });
      renderHook(() => useRunningStep(bridge));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      const calls = bridge.runningStepCalls;
      // The leading read just happened at t=0, so a burst now waits for the window to end.
      act(() => {
        for (let i = 0; i < 20; i += 1) bridge.emitChanged('job_activity');
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(249);
      });
      expect(bridge.runningStepCalls).toBe(calls);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(bridge.runningStepCalls).toBe(calls + 1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('makes no trailing read after unmount', async () => {
    vi.useFakeTimers();
    try {
      const bridge = createFakeHostBridge({ runningSteps: [step('one')] });
      const { unmount } = renderHook(() => useRunningStep(bridge));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      act(() => bridge.emitChanged('job_activity'));
      const calls = bridge.runningStepCalls;
      unmount();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(bridge.runningStepCalls).toBe(calls);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores an older reply that arrives after a newer one', async () => {
    const bridge = createFakeHostBridge();
    const replies: Array<(steps: RunningStep[]) => void> = [];
    bridge.runningSteps = () => new Promise((resolve) => replies.push(resolve));
    const { result } = renderHook(() => useRunningStep(bridge));
    expect(replies).toHaveLength(1);
    // Force a second read once the throttle window has passed.
    await new Promise((resolve) => setTimeout(resolve, 260));
    act(() => bridge.emitChanged('job_activity'));
    expect(replies).toHaveLength(2);
    await act(async () => replies[1]?.([step('newer')]));
    await act(async () => replies[0]?.([step('older')]));
    expect(result.current?.text).toBe('newer');
  });

  it('stops listening on unmount', async () => {
    const bridge = createFakeHostBridge({ runningSteps: [step('one')] });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <HostBridgeProvider bridge={bridge}>{children}</HostBridgeProvider>
    );
    const { unmount } = renderHook(() => useRunningStep(bridge), { wrapper });
    await waitFor(() => expect(bridge.runningStepCalls).toBe(1));
    unmount();
    act(() => bridge.emitChanged('job_activity'));
    expect(bridge.runningStepCalls).toBe(1);
  });
});

describe('JobLine', () => {
  it('is a card: the expert working, the command in code, silent, and no bar in the quick bubble', () => {
    render(<JobLine step={step('npm init -y')} onOpenTasks={() => undefined} />);
    const card = screen.getByTestId('job-line');
    expect(card).toHaveTextContent('Claude Code is working');
    expect(card.querySelector('code')).toHaveTextContent('npm init -y');
    expect(card.getAttribute('aria-live')).toBe('off');
    expect(card.hasAttribute('title')).toBe(false);
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('the full chat adds a bar that only says the job is moving', () => {
    render(<JobLine step={step('npm init -y')} onOpenTasks={() => undefined} bar />);
    expect(screen.getByRole('progressbar', { name: 'Working' })).not.toHaveAttribute(
      'aria-valuenow',
    );
  });

  it("shows the job's title when it has one", () => {
    render(
      <JobLine
        step={{ ...step('npm init -y'), title: 'Claude Code is fixing the fixture' }}
        onOpenTasks={() => undefined}
      />,
    );
    expect(screen.getByTestId('job-line')).toHaveTextContent('Claude Code is fixing the fixture');
    expect(screen.getByTestId('job-line')).not.toHaveTextContent('is working');
  });

  it('only a command is in code; any other step reads as plain words', () => {
    render(
      <JobLine step={{ ...step('edited src/a.ts'), kind: 'edit' }} onOpenTasks={() => undefined} />,
    );
    const card = screen.getByTestId('job-line');
    expect(card.querySelector('code')).toBeNull();
    expect(card).toHaveTextContent('edited src/a.ts');
  });

  it('Open in Tasks goes to the Tasks page', () => {
    const onOpenTasks = vi.fn();
    render(<JobLine step={step('npm init -y')} onOpenTasks={onOpenTasks} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open in Tasks' }));
    expect(onOpenTasks).toHaveBeenCalledOnce();
  });
});
