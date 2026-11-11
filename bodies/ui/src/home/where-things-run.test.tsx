/**
 * Tests for WhereThingsRun: each connected app by where it runs, Claude Code as a local
 * process, how Scout reads the screen, and the refetch when the brain changes. The brain
 * itself has its own card (brain-card.test.tsx).
 */

import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AppInfo } from '../shapes';
import { HostBridgeProvider, type BrainLink } from '../host-bridge';
import { createFakeHostBridge, type FakeHostBridge } from '../test-support/fake-host-bridge';
import { WhereThingsRun } from './where-things-run';

const FILES: AppInfo = {
  id: 'files',
  name: 'Files',
  transport: 'stdio',
  auth: 'none',
  enabled: true,
  status: 'connected',
  error: '',
  tools: [],
  command: 'node',
  args: ['files-server.js'],
};

const WIKI: AppInfo = {
  id: 'wiki',
  name: 'Wiki',
  transport: 'http',
  auth: 'none',
  enabled: true,
  status: 'error',
  error: 'Could not reach wiki.example.com.',
  tools: [],
  url: 'https://wiki.example.com/mcp',
};

const OFFLINE: BrainLink = { addr: 'ws://127.0.0.1:47321', status: 'offline', setup: 'idle' };

function renderCard(bridge: FakeHostBridge) {
  render(
    <HostBridgeProvider bridge={bridge}>
      <WhereThingsRun />
    </HostBridgeProvider>,
  );
}

const card = () => screen.findByRole('region', { name: 'Where things run' });

describe('WhereThingsRun', () => {
  it('has no Brain row: the brain card owns the address, the link and the setup lines', async () => {
    renderCard(createFakeHostBridge());
    const region = await card();
    expect(screen.queryByText('Brain')).toBeNull();
    expect(region).not.toHaveTextContent('ws://127.0.0.1:47321');
    expect(region).not.toHaveTextContent('Setting up');
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('shows a local app as its command and arguments, and a web app by its address', async () => {
    renderCard(createFakeHostBridge({ apps: [FILES, WIKI] }));
    const region = await card();
    await screen.findByText(/node files-server\.js/);
    expect(screen.getByText('Files').closest('p')).toHaveTextContent('Connected');
    expect(region).toHaveTextContent('Wiki');
    expect(region).toHaveTextContent('https://wiki.example.com/mcp');
    expect(region).toHaveTextContent('Not working');
  });

  it('gives each app an initial tile, its name over its location and a coloured chip', async () => {
    renderCard(createFakeHostBridge({ apps: [FILES, WIKI] }));
    await card();
    const row = (await screen.findByText('Wiki')).closest('p') as HTMLElement;
    expect(row.querySelector('.home-conn__initial')).toHaveTextContent('W');
    expect(row).toHaveTextContent('https://wiki.example.com/mcp');
    expect(screen.getByText('Not working').closest('.tg-chip')).toHaveClass('tg-chip--err');
    expect(screen.getAllByText('Connected', { selector: '.tg-chip--ok' })).toHaveLength(1);
  });

  it('names Claude Code as a local process the brain starts', async () => {
    renderCard(createFakeHostBridge());
    const region = await card();
    expect(region).toHaveTextContent('Claude Code');
    expect(region).toHaveTextContent('Runs on this machine, started by the brain');
  });

  it('reads again when the brain says its link changed', async () => {
    const bridge = createFakeHostBridge();
    renderCard(bridge);
    await card();
    const note = 'Connected apps show up when the brain is connected.';
    expect(screen.queryByText(note)).toBeNull();
    bridge.brainLink = () => Promise.resolve(OFFLINE);
    act(() => bridge.emitChanged('link'));
    await screen.findByText(note);
  });

  it('reads again when the brain says its apps changed', async () => {
    const bridge = createFakeHostBridge({ apps: [FILES] });
    renderCard(bridge);
    await screen.findByText(/node files-server\.js/);
    bridge.apps = [WIKI];
    act(() => bridge.emitChanged('apps'));
    expect(await screen.findByText(/https:\/\/wiki\.example\.com\/mcp/)).toBeInTheDocument();
  });

  it('reads again when connections change', async () => {
    const bridge = createFakeHostBridge({ apps: [] });
    renderCard(bridge);
    await card();
    bridge.apps = [FILES];
    act(() => bridge.emit({ type: 'connections.changed' }));
    expect(await screen.findByText(/node files-server\.js/)).toBeInTheDocument();
  });

  describe('how Scout reads your screen', () => {
    const OCR_ROW = {
      capability: 'text-from-pictures',
      engine: 'windows-ocr',
      where: 'this-pc',
      language: 'en-US',
    };
    const reading = (state: string) => JSON.stringify({ rows: [{ ...OCR_ROW, state }] });

    it('shows the group when the brain has rows, and checks again on open', async () => {
      const bridge = createFakeHostBridge({ reading: reading('needs-language-pack') });
      renderCard(bridge);
      expect(await screen.findByText('How Scout reads your screen')).toBeVisible();
      expect(screen.getByText('Needs a fix')).toBeVisible();
      expect(bridge.readingCalls).toContain('recheck');
    });

    it('has no group when there are no rows', async () => {
      renderCard(createFakeHostBridge());
      await card();
      expect(screen.queryByText('How Scout reads your screen')).toBeNull();
    });

    it('refetches when changed reading arrives', async () => {
      const bridge = createFakeHostBridge({ reading: reading('needs-language-pack') });
      renderCard(bridge);
      await screen.findByText('Needs a fix');
      bridge.reading = reading('working');
      act(() => bridge.emitChanged('reading'));
      expect(await screen.findByText('Working')).toBeVisible();
      expect(screen.queryByText('Needs a fix')).toBeNull();
    });
  });

  it('keeps a quiet note instead of apps while the brain is offline', async () => {
    renderCard(createFakeHostBridge({ brainLink: OFFLINE, apps: [FILES] }));
    const region = await card();
    expect(region).toHaveTextContent(/apps show up when the brain is connected/i);
    expect(region).not.toHaveTextContent('files-server.js');
  });

  it('hides the last app list while the brain is only connecting', async () => {
    const link: BrainLink = { ...OFFLINE, status: 'connecting' };
    renderCard(createFakeHostBridge({ brainLink: link, apps: [FILES] }));
    const region = await card();
    expect(region).toHaveTextContent(/apps show up when the brain is connected/i);
    expect(region).not.toHaveTextContent('files-server.js');
  });

  it('falls back to the command when the url is empty, and shows only the name if both are', async () => {
    const empty: AppInfo = { ...FILES, id: 'x', name: 'Odd', url: '', command: 'node', args: [] };
    const bare: AppInfo = { ...FILES, id: 'y', name: 'Bare', url: '', command: '', args: [] };
    renderCard(createFakeHostBridge({ apps: [empty, bare] }));
    await card();
    expect(await screen.findByText('Odd')).toBeInTheDocument();
    expect(screen.getByText('node')).toBeInTheDocument();
    expect(screen.getByText('Bare')).toBeInTheDocument();
  });
});
