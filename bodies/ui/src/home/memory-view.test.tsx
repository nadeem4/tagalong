/** Tests for MemoryView: rows, kind labels, delete, and the less common paths. */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MemoryEntry } from '../shapes';
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
  it('sizes the kind column to its chip and keeps the chip on one line', async () => {
    const { container } = render(
      <HostBridgeProvider bridge={createFakeHostBridge({ memories: [THREAD] })}>
        <MemoryView name="Scout" />
      </HostBridgeProvider>,
    );
    await screen.findByRole('list', { name: 'What Scout remembers' });
    const css = container.querySelector('style')?.textContent ?? '';
    expect(css).toContain('grid-template-columns: max-content minmax(0, 1fr) auto auto');
    expect(css).toMatch(/\.memory-row \.tg-chip[^{]*\{[^}]*white-space: nowrap/);
  });

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

  it('Delete sits inside its list item and names the fact', async () => {
    renderView(createFakeHostBridge({ memories: [TEA] }));
    const button = await screen.findByRole('button', { name: 'Delete: Prefers green tea' });
    expect(button).toHaveTextContent('Delete');
    expect(button.closest('li')).toHaveTextContent('Prefers green tea');
  });

  it('a 1,000-character fact wraps inside its row (wrap rule on the text)', async () => {
    const text = 'w'.repeat(1000);
    renderView(createFakeHostBridge({ memories: [{ ...TEA, text }] }));
    const cell = await screen.findByText(text);
    expect(cell).toHaveClass('memory-row__text');
    const css = [...document.querySelectorAll('style')].map((n) => n.textContent).join('');
    expect(css).toMatch(/\.memory-row__text \{[^}]*overflow-wrap: anywhere/);
  });

  it('shows its empty line', async () => {
    renderView(createFakeHostBridge({ memories: [] }));
    expect(await screen.findByText('Scout doesn’t remember anything yet.')).toBeVisible();
  });
});

describe('MemoryView, get to know me', () => {
  const FROM_GITHUB: MemoryEntry = {
    id: 'g1',
    kind: 'fact',
    text: 'Writes TypeScript',
    createdAt: AT,
    tag: 'skills',
    source: 'github',
    visibility: 'free',
  };
  const PERSONAL: MemoryEntry = {
    id: 'g2',
    kind: 'fact',
    text: 'Lives in Leeds',
    createdAt: AT,
    tag: 'personal',
    source: 'linkedin',
    visibility: 'asked',
  };
  const DONE = {
    sources: [{ name: 'GitHub', state: 'done' as const }],
    done: true,
    portrait: 'You build things.',
  };

  it('the button opens the run form', async () => {
    renderView(createFakeHostBridge({ memories: [] }));
    fireEvent.click(await screen.findByRole('button', { name: 'Get to know me' }));
    expect(await screen.findByLabelText('Your GitHub username')).toBeInTheDocument();
  });

  it('the form is hidden until the button is pressed', async () => {
    renderView(createFakeHostBridge({ memories: [] }));
    await screen.findByRole('button', { name: 'Get to know me' });
    expect(screen.queryByLabelText('Your GitHub username')).not.toBeInTheDocument();
  });

  it('says "again" when a portrait exists, and shows it above the list without a delete', async () => {
    renderView(createFakeHostBridge({ memories: [TEA], portrait: 'You build things.' }));
    expect(await screen.findByRole('button', { name: 'Get to know me again' })).toBeInTheDocument();
    const portrait = screen.getByRole('region', { name: 'Scout’s portrait of you' });
    expect(portrait).toHaveTextContent('You build things.');
    expect(within(portrait).queryByRole('button')).not.toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'What Scout remembers' });
    expect(portrait.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
  });

  it('shows no portrait block when there is none', async () => {
    renderView(createFakeHostBridge({ memories: [TEA] }));
    await screen.findByRole('list', { name: 'What Scout remembers' });
    expect(screen.queryByRole('region', { name: 'Scout’s portrait of you' })).toBeNull();
  });

  it('a row shows its tag and source, and a personal one says only if asked', async () => {
    renderView(createFakeHostBridge({ memories: [FROM_GITHUB, PERSONAL] }));
    const rows = within(
      await screen.findByRole('list', { name: 'What Scout remembers' }),
    ).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Skills');
    expect(rows[0]).toHaveTextContent('GitHub');
    expect(rows[0]).not.toHaveTextContent('only if asked');
    expect(rows[1]).toHaveTextContent('LinkedIn');
    expect(rows[1]).toHaveTextContent('only if asked');
  });

  it('a chat fact shows no source line', async () => {
    renderView(createFakeHostBridge({ memories: [{ ...REPO, source: 'chat' }] }));
    const row = (await screen.findAllByRole('listitem'))[0];
    expect(row).not.toHaveTextContent('chat');
  });

  it('the list and portrait refresh when a run finishes, and the result view shows', async () => {
    const bridge = createFakeHostBridge({ memories: [] });
    renderView(bridge);
    fireEvent.click(await screen.findByRole('button', { name: 'Get to know me' }));
    fireEvent.change(await screen.findByLabelText('Your GitHub username'), {
      target: { value: 'octocat' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Get to know me' }));
    await waitFor(() => expect(bridge.knowStarts).toHaveLength(1));
    bridge.memories = [FROM_GITHUB];
    bridge.portrait = 'You build things.';
    act(() => bridge.emitKnowStatus(DONE));
    expect(
      await screen.findByRole('heading', { name: "Here's who I think you are" }),
    ).toBeInTheDocument();
    const list = await screen.findByRole('list', { name: 'What Scout remembers' });
    expect(list).toHaveTextContent('Writes TypeScript');
    expect(screen.getByRole('region', { name: 'Scout’s portrait of you' })).toHaveTextContent(
      'You build things.',
    );
  });

  it('Looks right closes the panel', async () => {
    const bridge = createFakeHostBridge({ memories: [FROM_GITHUB], portrait: 'You build things.' });
    renderView(bridge);
    fireEvent.click(await screen.findByRole('button', { name: 'Get to know me again' }));
    fireEvent.change(await screen.findByLabelText('Your GitHub username'), {
      target: { value: 'octocat' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Get to know me' }));
    await waitFor(() => expect(bridge.knowStarts).toHaveLength(1));
    act(() => bridge.emitKnowStatus(DONE));
    fireEvent.click(await screen.findByRole('button', { name: 'Looks right' }));
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: "Here's who I think you are" })).toBeNull(),
    );
  });
});
