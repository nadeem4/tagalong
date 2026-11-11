/**
 * Tests for Scout's brain card, one per state of the mockup (running, update ready, started
 * by you, offline), plus the guarantees: a person's brain offers
 * no Restart, and "When your job finishes" waits for the work.
 */

import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  HostBridgeProvider,
  type BrainCard as BrainCardData,
  type BrainLink,
} from '../host-bridge';
import { createFakeHostBridge } from '../test-support/fake-host-bridge';
import { BrainCard } from './brain-card';

const RUNNING: BrainCardData = {
  status: 'running',
  update: 'none',
  version: '0.9.2',
  build: 'a1b2c3d',
  model: 'Claude Opus 5.5',
  appVersion: '0.9.2',
  appBuild: 'a1b2c3d',
  startedAt: new Date(Date.now() - 25 * 60_000).toISOString(),
  startedBy: 'desktop',
  addr: '127.0.0.1:47321',
  pid: 18420,
  dataDir: 'C:\\Users\\you\\.tagalong',
  logPath: 'C:\\Users\\you\\.tagalong\\brain.log',
  places: [
    { id: 'desktop', kind: 'desktop', name: 'Desktop' },
    { id: 'chrome', kind: 'browser', name: 'Chrome' },
    { id: 'wa', kind: 'whatsapp', name: 'WhatsApp' },
  ],
  workRunning: false,
};

const OFFLINE: BrainCardData = {
  ...RUNNING,
  status: 'offline',
  version: null,
  build: null,
  startedAt: null,
  startedBy: null,
  pid: null,
  places: [],
};

const LINK_OFFLINE: BrainLink = { addr: 'ws://127.0.0.1:47321', status: 'offline', setup: 'idle' };

function renderCard(brainCard: BrainCardData, brainLink?: BrainLink) {
  const bridge = createFakeHostBridge({ brainCard, ...(brainLink ? { brainLink } : {}) });
  render(
    <HostBridgeProvider bridge={bridge}>
      <BrainCard />
    </HostBridgeProvider>,
  );
  return bridge;
}

const region = () => screen.findByRole('region', { name: "Scout's brain" });

describe('BrainCard', () => {
  it('running: says what the brain is and lists its facts', async () => {
    renderCard(RUNNING);
    const card = await region();
    expect(card).toHaveTextContent(
      'The part of Scout that thinks, remembers and runs your jobs. It keeps running when you close Tagalong.',
    );
    expect(card).toHaveTextContent('Running · Up 25 min');
    expect(card).toHaveTextContent('This PC · 127.0.0.1:47321');
    expect(card).toHaveTextContent('Tagalong 0.9.2');
    expect(card).toHaveTextContent('Started by');
    expect(card).toHaveTextContent('Tagalong');
    expect(card).toHaveTextContent('18420');
    expect(card).toHaveTextContent('C:\\Users\\you\\.tagalong');
    expect(card).toHaveTextContent('brain.log');
    expect(card).toHaveTextContent('Places connected');
    expect(card).toHaveTextContent('3');
    for (const name of ['Desktop', 'Chrome', 'WhatsApp']) expect(card).toHaveTextContent(name);
    expect(screen.getByRole('button', { name: 'Restart brain' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Copy details' })).toBeVisible();
  });

  it('counts hours and minutes of uptime', async () => {
    renderCard({
      ...RUNNING,
      startedAt: new Date(Date.now() - (3 * 60 + 12) * 60_000).toISOString(),
    });
    expect(await region()).toHaveTextContent('Up 3 h 12 min');
  });

  it('version row: the app name, the version and the build', async () => {
    renderCard(RUNNING);
    expect(await region()).toHaveTextContent('Tagalong 0.9.2 · build a1b2c3d');
  });

  it('model row sits between Version and Started by and names the model', async () => {
    renderCard({ ...RUNNING, model: 'Claude Sonnet 5.5' });
    const labels = Array.from((await region()).querySelectorAll('dt')).map((dt) => dt.textContent);
    expect(labels.indexOf('Model')).toBe(labels.indexOf('Version') + 1);
    expect(labels.indexOf('Started by')).toBe(labels.indexOf('Model') + 1);
    expect(await region()).toHaveTextContent('ModelClaude Sonnet 5.5');
  });

  it('model row reads again when the brain says the model changed', async () => {
    const bridge = renderCard(RUNNING);
    expect(await region()).toHaveTextContent('Claude Opus 5.5');
    bridge.brainCard = () => Promise.resolve({ ...RUNNING, model: 'Claude Haiku 5.5' });
    act(() => bridge.emitChanged('model'));
    expect(await screen.findByText('Claude Haiku 5.5')).toBeVisible();
  });

  it('model row shows a dash when the model is not known', async () => {
    renderCard({ ...RUNNING, model: null });
    expect(await region()).toHaveTextContent('Model—');
  });

  it('update ready: warns, offers Restart now, and drops the plain Restart brain', async () => {
    renderCard({ ...RUNNING, update: 'ready', version: '0.9.1', build: '9f8e7d6' });
    const card = await region();
    expect(card).toHaveTextContent('Update ready');
    expect(card.querySelector('.brain-update svg[data-icon="alert"]')).not.toBeNull();
    expect(card).toHaveTextContent(
      "Scout's brain is from an older version. Restart to finish updating.",
    );
    expect(card).toHaveTextContent('Running · Update ready');
    expect(card).toHaveTextContent('Brain 0.9.1 · build 9f8e7d6 (app is 0.9.2 · a1b2c3d)');
    expect(screen.getByRole('button', { name: 'Restart now' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Restart brain' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'When your job finishes' })).toBeNull();
  });

  it('update ready while a job runs: says so and offers to wait', async () => {
    renderCard({ ...RUNNING, update: 'ready', version: '0.9.1', workRunning: true });
    const card = await region();
    expect(card).toHaveTextContent('Claude Code is running a job. Restarting now stops it.');
    expect(screen.getByRole('button', { name: 'When your job finishes' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Restart now' })).toBeVisible();
  });

  it('Restart now restarts the brain', async () => {
    const bridge = renderCard({ ...RUNNING, update: 'ready', version: '0.9.1' });
    fireEvent.click(await screen.findByRole('button', { name: 'Restart now' }));
    expect(bridge.brainActions).toEqual(['restart']);
  });

  it('When your job finishes calls restartBrainAfterWork', async () => {
    const bridge = renderCard({ ...RUNNING, update: 'ready', version: '0.9.1', workRunning: true });
    fireEvent.click(await screen.findByRole('button', { name: 'When your job finishes' }));
    expect(bridge.brainActions).toEqual(['restart-after-work']);
  });

  it('When your job finishes waits quietly once chosen', async () => {
    renderCard({ ...RUNNING, update: 'ready', version: '0.9.1', workRunning: true });
    const button = await screen.findByRole('button', { name: 'When your job finishes' });
    fireEvent.click(button);
    expect(button).toBeDisabled();
  });

  it('started by you with an older brain: the same warning, words instead of buttons', async () => {
    renderCard({ ...RUNNING, startedBy: 'person', update: 'terminal', version: '0.9.1' });
    const card = await region();
    expect(card).toHaveTextContent('Update ready');
    expect(card).toHaveTextContent(
      "Scout's brain is from an older version. Restart to finish updating.",
    );
    expect(card).toHaveTextContent(
      'You started it, so Tagalong leaves it alone. Restart it in your terminal.',
    );
    expect(card).not.toHaveTextContent('to finish updating.Restart it in your terminal');
    expect(screen.queryByRole('button', { name: /restart/i })).toBeNull();
  });

  it('started by you: says Tagalong leaves it alone, and has no restart button', async () => {
    renderCard({ ...RUNNING, startedBy: 'person' });
    const card = await region();
    // A current brain: no warning, the plain running status.
    expect(card).not.toHaveTextContent('Update ready');
    expect(card).toHaveTextContent('Running · Up 25 min');
    expect(card).toHaveTextContent('You, from a terminal');
    expect(card).toHaveTextContent(
      'You started it, so Tagalong leaves it alone. Restart it in your terminal.',
    );
    expect(screen.queryByRole('button', { name: 'Restart brain' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Restart now' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Copy details' })).toBeVisible();
  });

  it('offline: names the retry rhythm, offers Start brain and dims what it cannot know', async () => {
    const bridge = renderCard(OFFLINE, LINK_OFFLINE);
    const card = await region();
    expect(card).toHaveTextContent("Can't reach Scout's brain. Trying again every 2 s.");
    expect(card).toHaveTextContent('Offline · Reconnecting');
    expect(card).toHaveTextContent('This PC · 127.0.0.1:47321');
    expect(card).toHaveTextContent('None while offline');
    expect(card.querySelector('.brain-error svg[data-icon="err"]')).not.toBeNull();
    // The app's own version and build, and who would start it; only the process id is unknown.
    expect(card).toHaveTextContent('Tagalong 0.9.2 · build a1b2c3d');
    expect(card).toHaveTextContent('Started byTagalong');
    expect(within(card).getAllByText('—')).toHaveLength(1);
    // Open log sits in the log row and again in the footer, where the reason is.
    expect(screen.getAllByRole('button', { name: 'Open log' })).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Start brain' }));
    expect(bridge.setupRetries()).toBe(1);
  });

  it('Open folder, Open log and Copy details reach the host', async () => {
    const bridge = renderCard(RUNNING);
    fireEvent.click(await screen.findByRole('button', { name: 'Open folder' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open log' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy details' }));
    expect(bridge.brainActions).toEqual(['open-folder', 'open-log', 'copy-details']);
  });

  it('says the brain is being set up while it installs', async () => {
    renderCard(OFFLINE, { ...LINK_OFFLINE, setup: 'installing' });
    const card = await region();
    expect(card).toHaveTextContent("Setting up Scout's brain — one-time download");
    expect(screen.queryByRole('button', { name: 'Start brain' })).toBeNull();
  });

  it('says it did not finish when setup failed, and Retry runs it again', async () => {
    const bridge = renderCard(OFFLINE, { ...LINK_OFFLINE, setup: 'failed' });
    expect(await region()).toHaveTextContent("Scout's brain did not finish setting up.");
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(bridge.setupRetries()).toBe(1);
  });
});
