/** Tests for ExpertsTab: official experts add as before, community ones go through the check card. */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HostBridgeProvider } from '../host-bridge';
import { createFakeHostBridge } from '../test-support/fake-host-bridge';
import { ConnectionsPanel } from './connections-panel';

const OFFICIAL = {
  id: 'codex-acp',
  name: 'Codex',
  version: '1',
  description: 'OpenAI’s agent',
  official: true,
};
const COMMUNITY = {
  id: 'someone-acp',
  name: 'Someone',
  version: '1',
  description: 'A community agent',
  official: false,
};

async function open(browseExperts: (typeof OFFICIAL)[]) {
  const bridge = createFakeHostBridge({ setup: { browseExperts } });
  render(
    <HostBridgeProvider bridge={bridge}>
      <ConnectionsPanel />
    </HostBridgeProvider>,
  );
  await screen.findByRole('heading', { name: 'Connections' });
  fireEvent.click(screen.getByRole('tab', { name: 'Experts' }));
  return bridge;
}

const click = async (element: HTMLElement) => {
  await act(async () => {
    fireEvent.click(element);
    await Promise.resolve();
  });
};

describe('ExpertsTab', () => {
  it('tags an official expert and adds it with the brain’s own Allow card', async () => {
    const bridge = await open([OFFICIAL]);
    expect(screen.getByText('Official')).toBeTruthy();
    await click(screen.getByRole('button', { name: 'Add Codex' }));
    expect(bridge.setupCalls).toEqual([{ kind: 'expert', id: 'codex-acp', approved: false }]);
  });

  it('a community expert shows the check card first; Connect anyway sends community ok', async () => {
    const bridge = await open([COMMUNITY]);
    expect(screen.getByText('Community')).toBeTruthy();
    await click(screen.getByRole('button', { name: 'Connect Someone' }));
    expect(screen.getByRole('group', { name: 'Check before connecting' })).toBeTruthy();
    expect(screen.getByText('Not yet audited by anyone')).toBeTruthy();
    expect(bridge.setupCalls).toEqual([]);
    await click(screen.getByRole('button', { name: 'Connect anyway' }));
    expect(bridge.setupCalls).toEqual([
      { kind: 'expert', id: 'someone-acp', approved: true, communityOk: true },
    ]);
  });

  it('Back on the check card sends nothing', async () => {
    const bridge = await open([COMMUNITY]);
    await click(screen.getByRole('button', { name: 'Connect Someone' }));
    await click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.queryByRole('group', { name: 'Check before connecting' })).toBeNull();
    expect(bridge.setupCalls).toEqual([]);
  });
});
