// @vitest-environment jsdom
/** Tests for the side panel UI across connection states. */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ContextSnapshot, Pet } from '@tagalong/protocol';
import { createFakeHostBridge } from '@tagalong/ui';
import type { ConnectionStatus } from '../engine-connection';
import type { PortBridge } from '../port-bridge';
import { PAGE_TARGETS } from '../page-targets';
import { SidePanelApp } from './app';

afterEach(cleanup);

const pet = (id: string, name: string): Pet => ({
  id,
  name,
  avatar: '🐣',
  providerId: 'fake',
  model: 'fake-model',
  roleId: 'companion',
});

const PAGE: ContextSnapshot = {
  id: '6f1c2f0e-2a4b-4c1d-9e8f-0a1b2c3d4e5f',
  capturedAt: '2026-10-04T00:00:00.000Z',
  host: 'extension',
  app: { name: 'chrome', windowTitle: 'Release notes' },
  page: { url: 'https://example.com/notes', title: 'Release notes', text: 'The article.' },
};

/** The shared fake bridge plus the two extension extras, driven by the test. */
function fakeBridge(capture: ContextSnapshot | null = PAGE) {
  const base = createFakeHostBridge({ capture });
  const statusHandlers = new Set<(s: ConnectionStatus) => void>();
  const contextHandlers = new Set<(s: ContextSnapshot | null) => void>();
  let last: ConnectionStatus | null = null;
  const bridge: PortBridge & typeof base = Object.assign(base, {
    onStatus(handler: (s: ConnectionStatus) => void) {
      if (last !== null) handler(last);
      statusHandlers.add(handler);
      return () => void statusHandlers.delete(handler);
    },
    onContext(handler: (s: ContextSnapshot | null) => void) {
      contextHandlers.add(handler);
      return () => void contextHandlers.delete(handler);
    },
  });
  return {
    bridge,
    setStatus: (status: ConnectionStatus) => {
      last = status;
      act(() => statusHandlers.forEach((h) => h(status)));
    },
    pushContext: (snapshot: ContextSnapshot | null) =>
      act(() => contextHandlers.forEach((h) => h(snapshot))),
  };
}

const CONNECTED: ConnectionStatus = {
  state: 'connected',
  engineVersion: '1.2.3',
  pets: [pet('scout', 'Scout'), pet('fern', 'Fern')],
};

function send(text: string): void {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: text } });
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
}

describe('SidePanelApp', () => {
  it('shows the chat once connected, with no pet picker', () => {
    const f = fakeBridge();
    render(<SidePanelApp bridge={f.bridge} openOptions={vi.fn()} />);
    f.setStatus(CONNECTED);
    expect(screen.getByRole('textbox')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Crew' })).toBeNull();
  });

  it('shows disconnected, with the reason, while the app is down', () => {
    const f = fakeBridge();
    render(<SidePanelApp bridge={f.bridge} openOptions={vi.fn()} />);
    f.setStatus({
      state: 'disconnected',
      reason: 'could not reach the Tagalong app',
      retryInMs: 4000,
    });
    const banner = screen.getByTestId('connection');
    expect(banner.getAttribute('data-state')).toBe('disconnected');
    expect(banner.textContent).toContain('Is the Tagalong app running?');
    // Never connected, so there is no one to ask yet.
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('keeps the conversation on screen when the app goes away mid-session', async () => {
    const f = fakeBridge();
    render(<SidePanelApp bridge={f.bridge} openOptions={vi.fn()} />);
    f.setStatus(CONNECTED);
    send('first question');
    f.setStatus({ state: 'disconnected', reason: 'x', retryInMs: 1000 });
    expect(screen.getByTestId('connection').getAttribute('data-state')).toBe('disconnected');
    expect(document.body.textContent).toContain('first question');
    f.setStatus(CONNECTED);
    expect(document.body.textContent).toContain('first question');
  });

  it('recovers when the app comes back', () => {
    const f = fakeBridge();
    render(<SidePanelApp bridge={f.bridge} openOptions={vi.fn()} />);
    f.setStatus({ state: 'disconnected', reason: 'x', retryInMs: 1000 });
    f.setStatus(CONNECTED);
    expect(screen.getByTestId('connection').getAttribute('data-state')).toBe('connected');
    expect(screen.getByRole('textbox')).toBeTruthy();
  });

  it('sends an unpaired user to the pairing page', () => {
    const f = fakeBridge();
    const openOptions = vi.fn();
    render(<SidePanelApp bridge={f.bridge} openOptions={openOptions} />);
    f.setStatus({ state: 'unpaired' });
    fireEvent.click(screen.getByRole('button', { name: 'Pair with the Tagalong app' }));
    expect(openOptions).toHaveBeenCalled();
  });

  it('reads the page it opened beside, so an ask with nothing selected uses the page text', async () => {
    const f = fakeBridge();
    render(<SidePanelApp bridge={f.bridge} openOptions={vi.fn()} />);
    f.setStatus(CONNECTED);
    await waitFor(() =>
      expect(screen.getByTestId('sight-bar').textContent).toContain('Release notes'),
    );
    expect(f.bridge.captures).toEqual([PAGE_TARGETS]);

    send('Summarise this page');
    expect(f.bridge.asks).toEqual([
      { petId: 'scout', text: 'Summarise this page', snapshot: PAGE },
    ]);
  });

  it('attaches what the shortcut captured: the exact selection and the page title', async () => {
    const f = fakeBridge();
    render(<SidePanelApp bridge={f.bridge} openOptions={vi.fn()} />);
    f.setStatus(CONNECTED);
    const selected = {
      ...PAGE,
      id: '7f1c2f0e-2a4b-4c1d-9e8f-0a1b2c3d4e5f',
      selection: 'the exact words',
    };
    f.pushContext(selected);
    await waitFor(() => expect(screen.getByTestId('sight-bar').textContent).toContain('15 chars'));
    expect(screen.getByTestId('sight-bar').textContent).toContain('page “Release notes”');

    send('Explain this');
    expect(f.bridge.asks.at(-1)).toEqual({
      petId: 'scout',
      text: 'Explain this',
      snapshot: selected,
    });
  });

  it('clears the chip when the tab switched to could not be read', async () => {
    const f = fakeBridge();
    render(<SidePanelApp bridge={f.bridge} openOptions={vi.fn()} />);
    f.setStatus(CONNECTED);
    await waitFor(() =>
      expect(screen.getByTestId('sight-bar').textContent).toContain('Release notes'),
    );
    f.pushContext(null);
    await waitFor(() =>
      expect(screen.getByTestId('sight-bar').getAttribute('data-state')).toBe('blind'),
    );
  });

  it('asks the first pet the engine lists: Scout', () => {
    const f = fakeBridge();
    render(<SidePanelApp bridge={f.bridge} openOptions={vi.fn()} />);
    f.setStatus(CONNECTED);
    send('hello');
    expect(f.bridge.asks.at(-1)?.petId).toBe('scout');
  });

  it('streams the answer into the panel', async () => {
    const f = fakeBridge();
    render(<SidePanelApp bridge={f.bridge} openOptions={vi.fn()} />);
    f.setStatus(CONNECTED);
    send('hi');
    act(() => {
      f.bridge.emit({ type: 'turn.started', turnId: 't1', petId: 'scout', conversationId: 'c1' });
      f.bridge.emit({ type: 'turn.delta', turnId: 't1', text: 'Hello from' });
      f.bridge.emit({ type: 'turn.delta', turnId: 't1', text: ' the panel' });
    });
    await waitFor(() => expect(document.body.textContent).toContain('Hello from the panel'));
  });

  it('labels Look for what the browser does: read the page', () => {
    const f = fakeBridge(null);
    render(<SidePanelApp bridge={f.bridge} openOptions={vi.fn()} />);
    f.setStatus(CONNECTED);
    expect(screen.getByRole('button', { name: 'Read this page' })).toBeTruthy();
  });
});
