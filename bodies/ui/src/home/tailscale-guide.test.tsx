/**
 * Tests for TailscaleGuide: which of its four steps are done follows what the desktop finds
 * (the tailscale command, the brain's address), and a PC without Tailscale starts at Install.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HostBridgeProvider } from '../host-bridge';
import type { BrainCard } from '../host-bridge';
import { createFakeHostBridge } from '../test-support/fake-host-bridge';
import { TailscaleGuide } from './tailscale-guide';

const REMOTE: BrainCard = {
  status: 'running',
  update: 'none',
  version: '0.9.2',
  build: 'a1b2c3d',
  model: null,
  appVersion: '0.9.2',
  appBuild: 'a1b2c3d',
  startedAt: null,
  startedBy: null,
  addr: '100.101.102.103:47321',
  pid: null,
  dataDir: '',
  logPath: '',
  places: [],
  workRunning: false,
  host: 'mini-pc',
  local: false,
};

function open(tailscale: { installed: boolean; ip: string | null }, brainCard?: BrainCard) {
  const bridge = createFakeHostBridge({ tailscale, ...(brainCard ? { brainCard } : {}) });
  render(
    <HostBridgeProvider bridge={bridge}>
      <TailscaleGuide onClose={() => undefined} />
    </HostBridgeProvider>,
  );
  return bridge;
}

describe('TailscaleGuide', () => {
  it('starts at Install Tailscale when there is no tailscale command, and opens the download page', async () => {
    const bridge = open({ installed: false, ip: null });
    fireEvent.click(
      await screen.findByRole('button', { name: 'Open the Tailscale download page' }),
    );
    expect(bridge.brainActions).toContain('open-tailscale');
    expect(screen.getByText('Install Tailscale on this device')).toBeInTheDocument();
  });

  it('marks this device done once it has a tailnet address', async () => {
    open({ installed: true, ip: '100.64.0.7' });
    expect(await screen.findByText('Tailscale is running on this device')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open the Tailscale download page' })).toBeNull();
  });

  it('is Working, with the address to copy, when the brain is reached over its tailnet address', async () => {
    const bridge = open({ installed: true, ip: '100.64.0.7' }, REMOTE);
    expect(await screen.findByText('Working')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(bridge.copied).toEqual(['100.101.102.103']);
  });
});
