/** Tests for MemoryView: rows, kind labels, delete, and the less common paths. */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MemoryEntry } from '@tagalong/protocol';
import { HostBridgeProvider } from '../host-bridge';
import { createFakeHostBridge, type FakeHostBridge } from '../test-support/fake-host-bridge';
import { MemoryView } from './memory-view';

const AT = '2026-10-16T09:00:00.000Z';
const TEA: MemoryEntry = { id: 'm1', kind: 'preference', text: 'Prefers green tea', createdAt: AT };
const REPO: MemoryEntry = { id: 'm2', kind: 'fact', text: 'Works on Tagalong', createdAt: AT };
const THREAD: MemoryEntry = {
  id: 'm3',
  kind: 'summary',
  text: 'Talked about the launch.',
  createdAt: AT,
};

function renderView(bridge: FakeHostBridge) {
  render(
    <HostBridgeProvider bridge={bridge}>
      <MemoryView name="Scout" />
    </HostBridgeProvider>,
  );
}

describe('MemoryView', () => {
  it('lists each memory newest first, with its kind', async () => {
    renderView(createFakeHostBridge({ memories: [TEA, REPO, THREAD] }));
    const rows = within(
      await screen.findByRole('list', { name: 'What Scout remembers' }),
    ).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('Preference');
    expect(rows[0]).toHaveTextContent('Prefers green tea');
    expect(rows[1]).toHaveTextContent('Fact');
    expect(rows[2]).toHaveTextContent('Conversation summary');
    expect(screen.getByRole('heading', { name: 'What Scout remembers' })).toBeInTheDocument();
  });

  it('deletes one memory, and the row goes', async () => {
    const bridge = createFakeHostBridge({ memories: [TEA, REPO] });
    renderView(bridge);
    const list = await screen.findByRole('list', { name: 'What Scout remembers' });
    fireEvent.click(within(list).getByRole('button', { name: 'Delete: Prefers green tea' }));
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(1));
    expect(bridge.memories.map((m) => m.id)).toEqual(['m2']);
  });

  it('keeps the row when deleting fails', async () => {
    const bridge = createFakeHostBridge({ memories: [TEA] });
    bridge.deleteMemory = () => Promise.reject(new Error('locked'));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderView(bridge);
    const list = await screen.findByRole('list', { name: 'What Scout remembers' });
    fireEvent.click(within(list).getByRole('button', { name: /^Delete:/ }));
    await waitFor(() => expect(errors).toHaveBeenCalledTimes(1));
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    errors.mockRestore();
  });

  it('has an empty state', async () => {
    renderView(createFakeHostBridge({ memories: [] }));
    expect(await screen.findByText('Scout doesn’t remember anything yet.')).toBeInTheDocument();
  });

  it('says so when the memories cannot be read', async () => {
    const bridge = createFakeHostBridge();
    bridge.listMemories = () => Promise.reject(new Error('engine down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderView(bridge);
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not read/);
    vi.restoreAllMocks();
  });

  it('reads again when the brain says memory changed, and only then', async () => {
    const bridge = createFakeHostBridge({ memories: [] });
    renderView(bridge);
    await screen.findByText('Scout doesn’t remember anything yet.');
    bridge.memories = [TEA];
    act(() => bridge.emitChanged('permissions'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole('list', { name: 'What Scout remembers' })).toBeNull();
    act(() => bridge.emitChanged('memory'));
    expect(await screen.findByRole('list', { name: 'What Scout remembers' })).toHaveTextContent(
      'Prefers green tea',
    );
  });

  it('stops listening for changes when it goes away', async () => {
    const bridge = createFakeHostBridge({ memories: [] });
    const off = vi.fn();
    bridge.onBrainChanged = () => off;
    const { unmount } = render(
      <HostBridgeProvider bridge={bridge}>
        <MemoryView name="Scout" />
      </HostBridgeProvider>,
    );
    await screen.findByText('Scout doesn’t remember anything yet.');
    unmount();
    expect(off).toHaveBeenCalled();
  });

  it('works on a host that never reports changes', async () => {
    const bridge = createFakeHostBridge({ memories: [TEA] });
    delete bridge.onBrainChanged;
    renderView(bridge);
    expect(await screen.findByRole('list', { name: 'What Scout remembers' })).toBeInTheDocument();
  });

  it('says the page is not available on a host without it', () => {
    const bridge = createFakeHostBridge();
    delete bridge.listMemories;
    renderView(bridge);
    expect(screen.getByText('This page is not available here.')).toBeInTheDocument();
  });
});
