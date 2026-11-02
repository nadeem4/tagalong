/** Tests for useRunningStep and JobLine: the bubble's one live line for a running job. */

import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HostBridgeProvider } from './host-bridge';
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
    const bridge = createFakeHostBridge({ runningSteps: [step('one')] });
    const { result } = renderHook(() => useRunningStep(bridge));
    await waitFor(() => expect(result.current).not.toBeNull());
    const calls = bridge.runningStepCalls;
    bridge.running = [step('last')];
    act(() => {
      for (let i = 0; i < 20; i += 1) bridge.emitChanged('job_activity');
    });
    await waitFor(() => expect(result.current?.text).toBe('last'));
    expect(bridge.runningStepCalls - calls).toBeLessThanOrEqual(2);
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
  it('shows the expert and the step title, muted and silent', () => {
    render(<JobLine step={step('npm init -y')} />);
    const line = screen.getByTestId('job-line');
    expect(line.textContent).toBe('Claude Code: npm init -y');
    expect(line.getAttribute('aria-live')).toBe('off');
    expect(line.getAttribute('title')).toBe('Claude Code: npm init -y');
  });
});
