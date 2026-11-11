/**
 * Tests for the update banner at the top of every Home page: it shows only when the brain is
 * older than the app, in the mockup's words, and never offers a restart for a person's brain.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HostBridgeProvider, type BrainCard } from '../host-bridge';
import { createFakeHostBridge } from '../test-support/fake-host-bridge';
import { UpdateBanner } from './update-banner';

const READY: BrainCard = {
  status: 'running',
  update: 'ready',
  version: '0.9.1',
  build: '9f8e7d6',
  appVersion: '0.9.2',
  appBuild: 'a1b2c3d',
  startedAt: new Date().toISOString(),
  startedBy: 'desktop',
  addr: '127.0.0.1:47321',
  pid: 18420,
  dataDir: 'C:\\Users\\you\\.tagalong',
  logPath: 'C:\\Users\\you\\.tagalong\\brain.log',
  places: [],
  workRunning: false,
};

function renderBanner(brainCard: BrainCard) {
  const bridge = createFakeHostBridge({ brainCard });
  const view = render(
    <HostBridgeProvider bridge={bridge}>
      <UpdateBanner />
    </HostBridgeProvider>,
  );
  return { bridge, view };
}

describe('UpdateBanner', () => {
  it('shows the exact banner copy with Restart now', async () => {
    const { bridge } = renderBanner(READY);
    const banner = await screen.findByRole('status');
    expect(banner).toHaveTextContent('Update ready');
    expect(banner).toHaveTextContent(
      "Scout's brain is from an older version. Restart to finish updating.",
    );
    fireEvent.click(screen.getByRole('button', { name: 'Restart now' }));
    expect(bridge.brainActions).toEqual(['restart']);
  });

  it('offers to wait while a job runs', async () => {
    const { bridge } = renderBanner({ ...READY, workRunning: true });
    const banner = await screen.findByRole('status');
    expect(banner).toHaveTextContent('Claude Code is running a job. Restarting now stops it.');
    fireEvent.click(screen.getByRole('button', { name: 'When your job finishes' }));
    expect(bridge.brainActions).toEqual(['restart-after-work']);
  });

  it('started by you says restart it in your terminal, with no restart button', async () => {
    renderBanner({ ...READY, update: 'terminal', startedBy: 'person' });
    const banner = await screen.findByRole('status');
    expect(banner).toHaveTextContent(
      'You started it, so Tagalong leaves it alone. Restart it in your terminal.',
    );
    expect(screen.queryByRole('button', { name: /restart/i })).toBeNull();
  });

  it('shows nothing when the brain is current', async () => {
    const { bridge, view } = renderBanner({ ...READY, update: 'none' });
    await bridge.brainCard();
    expect(view.container).toBeEmptyDOMElement();
  });
});
