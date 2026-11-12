/** Tests for useKnowMe: the sources, the status subscription, running until done, start errors. */

import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { HostBridgeProvider } from '../host-bridge';
import { createFakeHostBridge } from '../test-support/fake-host-bridge';
import { useKnowMe } from './use-know-me';

function setup(options: Parameters<typeof createFakeHostBridge>[0] = {}) {
  const bridge = createFakeHostBridge(options);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <HostBridgeProvider bridge={bridge}>{children}</HostBridgeProvider>
  );
  return { bridge, ...renderHook(() => useKnowMe(), { wrapper }) };
}

describe('useKnowMe', () => {
  it('loads the sources once', async () => {
    const { result } = setup();
    await waitFor(() =>
      expect(result.current.sources.map((s) => s.name)).toEqual(['github', 'linkedin', 'web']),
    );
  });

  it('says the brain is away when the sources cannot load, and loads them when it is back', async () => {
    const { bridge, result } = setup();
    const real = bridge.knowMeSources;
    bridge.knowMeSources = () => Promise.reject(new Error('offline'));
    act(() => bridge.emitChanged('link'));
    await waitFor(() => expect(result.current.error).toBe('Scout is not connected right now.'));
    bridge.knowMeSources = real;
    act(() => bridge.emitChanged('link'));
    // The mount load already filled the sources, so wait on the error clearing instead.
    await waitFor(() => expect(result.current.error).toBeNull());
    expect(result.current.sources).toHaveLength(3);
  });

  it('subscribes on mount, before any start, and unsubscribes on unmount', () => {
    const { bridge, unmount } = setup();
    expect(bridge.knowStatusListeners).toBe(1);
    unmount();
    expect(bridge.knowStatusListeners).toBe(0);
  });

  it('is running from start until a status says done', async () => {
    const { bridge, result } = setup();
    expect(result.current.running).toBe(false);
    await act(async () => {
      await result.current.start({ github: 'octo' });
    });
    expect(bridge.knowStarts).toEqual([{ github: 'octo' }]);
    expect(result.current.running).toBe(true);
    act(() =>
      bridge.emitKnowStatus({ done: false, sources: [{ name: 'GitHub', state: 'reading' }] }),
    );
    expect(result.current.running).toBe(true);
    expect(result.current.status?.sources[0]?.state).toBe('reading');
    act(() => bridge.emitKnowStatus({ done: true, sources: [{ name: 'GitHub', state: 'done' }] }));
    expect(result.current.running).toBe(false);
  });

  it('keeps a status that arrives before the start reply', async () => {
    const { bridge, result } = setup();
    let release: () => void = () => undefined;
    bridge.knowMeStart = () =>
      new Promise((resolve) => (release = () => resolve({ joined: false })));
    let started: Promise<void> = Promise.resolve();
    act(() => {
      started = result.current.start({ github: 'octo' });
    });
    act(() =>
      bridge.emitKnowStatus({ done: false, sources: [{ name: 'GitHub', state: 'reading' }] }),
    );
    await act(async () => {
      release();
      await started;
    });
    expect(result.current.status?.sources[0]?.state).toBe('reading');
    expect(result.current.running).toBe(true);
  });

  it('surfaces a refused start as a message and stops running', async () => {
    const { result } = setup({ knowStartError: 'That PDF is over 10 MB.' });
    await act(async () => {
      await result.current.start({ github: 'octo' });
    });
    expect(result.current.error).toBe('That PDF is over 10 MB.');
    expect(result.current.running).toBe(false);
  });
});
