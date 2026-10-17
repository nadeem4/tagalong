/** Tests for SettingsCard: Apply, Turn on and Cancel. */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SETTINGS_DEFAULTS, type SettingsProposedParams } from '@tagalong/protocol';
import { CompanionBubble } from './companion-bubble';
import { HostBridgeProvider } from './host-bridge';
import { createFakeHostBridge, type FakeHostBridge } from './test-support/fake-host-bridge';

const PROPOSAL = '50000000-0000-4000-8000-000000000001';

const proposed = (
  patch: Partial<SettingsProposedParams> = {},
): SettingsProposedParams & { type: 'settings.proposed' } => ({
  type: 'settings.proposed',
  proposalId: PROPOSAL,
  petId: 'scout',
  patch: { voice: { ...SETTINGS_DEFAULTS.voice, speed: 0.85 }, userName: 'Sam' },
  rows: [
    { setting: 'voice.speed', label: 'Voice speed', from: '0.95', to: '0.85', loosens: false },
    { setting: 'userName', label: 'Your name', from: '(none)', to: 'Sam', loosens: false },
  ],
  ...patch,
});

function renderBubble(bridge: FakeHostBridge) {
  render(
    <HostBridgeProvider bridge={bridge}>
      <CompanionBubble petId="scout" petName="Scout" />
    </HostBridgeProvider>,
  );
}

const flush = () => act(async () => await Promise.resolve());

describe('the settings card', () => {
  it('shows each setting now and after, and applies the exact patch only on Apply', async () => {
    const bridge = createFakeHostBridge();
    renderBubble(bridge);
    act(() => bridge.emit(proposed()));
    const card = screen.getByRole('region', { name: 'Change these settings?' });
    expect(card).toHaveTextContent('Voice speed');
    expect(card).toHaveTextContent('0.95');
    expect(card).toHaveTextContent('0.85');
    expect(card).toHaveTextContent('(none)');
    expect(card).toHaveTextContent('Sam');
    expect(card).toHaveTextContent('Nothing changes until you apply it.');
    expect(card).not.toHaveTextContent(/\bI[’']/);
    expect(bridge.appliedSettings).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await flush();
    expect(bridge.appliedSettings).toEqual([proposed().patch]);
    expect(
      screen.queryByRole('region', { name: 'Change these settings?' }),
    ).not.toBeInTheDocument();
  });

  it('changes nothing on Cancel', async () => {
    const bridge = createFakeHostBridge();
    renderBubble(bridge);
    act(() => bridge.emit(proposed()));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await flush();
    expect(bridge.appliedSettings).toEqual([]);
    expect(
      screen.queryByRole('region', { name: 'Change these settings?' }),
    ).not.toBeInTheDocument();
  });

  it('marks a loosening row and reads Turn on', () => {
    const bridge = createFakeHostBridge();
    renderBubble(bridge);
    act(() =>
      bridge.emit(
        proposed({
          patch: { pickUp: true },
          rows: [
            {
              setting: 'pickUp',
              label: 'Pick up where you left off',
              from: 'Off',
              to: 'On',
              loosens: true,
              note: 'Lets Scout see or keep more of your screen',
            },
          ],
        }),
      ),
    );
    expect(screen.getByText('Lets Scout see or keep more of your screen')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Turn on' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apply' })).not.toBeInTheDocument();
  });

  it('says why when applying fails, and keeps the card', async () => {
    const bridge = createFakeHostBridge();
    bridge.applySettings = () => Promise.reject(new Error('The settings file is read-only.'));
    renderBubble(bridge);
    act(() => bridge.emit(proposed()));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await flush();
    expect(screen.getByRole('alert')).toHaveTextContent('The settings file is read-only.');
    expect(screen.getByRole('region', { name: 'Change these settings?' })).toBeInTheDocument();
  });

  it('never claims it applied on a host that cannot apply a card', async () => {
    const bridge = createFakeHostBridge();
    Object.assign(bridge, { applySettings: undefined });
    renderBubble(bridge);
    act(() => bridge.emit(proposed()));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await flush();
    expect(screen.getByRole('alert')).toHaveTextContent('Settings');
    expect(screen.getByRole('region', { name: 'Change these settings?' })).toBeInTheDocument();
  });
});
