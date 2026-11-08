/**
 * Tests for BodiesPanel: the three bodies and their state, and the WhatsApp setup (five fields,
 * the switch, Save). A saved secret shows only the word Saved; a typed one is cleared after a save.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HostBridgeProvider } from '../host-bridge';
import type { BodiesState } from '../shapes';
import { createFakeHostBridge } from '../test-support/fake-host-bridge';
import type { FakeHostBridge } from '../test-support/fake-host-bridge';
import { BodiesPanel } from './bodies-panel';

const SET_ALL = {
  accessToken: true,
  appSecret: true,
  verifyToken: true,
  phoneNumberId: true,
  allowedNumber: true,
};

function stateWith(
  whatsapp: Partial<BodiesState['whatsapp']> = {},
  connected = ['desktop'],
): BodiesState {
  return {
    bodies: (['desktop', 'browser', 'whatsapp'] as const).map((kind) => ({
      kind,
      name: kind === 'whatsapp' ? 'WhatsApp' : kind[0]!.toUpperCase() + kind.slice(1),
      connected: connected.includes(kind),
    })),
    whatsapp: {
      enabled: false,
      set: {
        accessToken: false,
        appSecret: false,
        verifyToken: false,
        phoneNumberId: false,
        allowedNumber: false,
      },
      complete: false,
      state: 'off',
      port: 47322,
      ...whatsapp,
    },
  };
}

function open(bodies: BodiesState = stateWith()): FakeHostBridge {
  const bridge = createFakeHostBridge({ bodies });
  render(
    <HostBridgeProvider bridge={bridge}>
      <BodiesPanel />
    </HostBridgeProvider>,
  );
  return bridge;
}

const type = (label: RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('BodiesPanel', () => {
  it('lists the three bodies with their state', async () => {
    open(stateWith({}, ['desktop', 'whatsapp']));
    const list = await screen.findByRole('list', { name: 'Bodies' });
    const rows = Array.from(list.querySelectorAll('li')).map((li) => li.textContent);
    expect(rows).toEqual(['DesktopConnected', 'BrowserNot connected', 'WhatsAppConnected']);
  });

  it('shows a saved value as Saved and never its value', async () => {
    open(stateWith({ set: { ...SET_ALL, verifyToken: false } }));
    const field = await screen.findByLabelText(/Access token/);
    expect(field).toHaveValue('');
    expect(field).toHaveAttribute('type', 'password');
    expect(field).toHaveAttribute('placeholder', 'Saved');
    expect(screen.getByLabelText(/Verify token/)).toHaveAttribute('placeholder', '');
  });

  it('saves only the fields typed, then clears them', async () => {
    const bridge = open();
    await screen.findByLabelText(/Access token/);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    type(/Access token/, ' EAAG-fake-token ');
    type(/Your number/, '+44 7700 900123');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(bridge.whatsappChanges).toEqual([
        { accessToken: 'EAAG-fake-token', allowedNumber: '+44 7700 900123' },
      ]),
    );
    await waitFor(() => expect(screen.getByLabelText(/Access token/)).toHaveValue(''));
    expect(screen.getByLabelText(/Your number/)).toHaveValue('');
    expect(screen.getByLabelText(/Access token/)).toHaveAttribute('placeholder', 'Saved');
  });

  it('marks the form busy while a save is in flight', async () => {
    open();
    await screen.findByLabelText(/Access token/);
    const form = screen.getByLabelText(/Access token/).closest('form')!;
    expect(form).toHaveAttribute('aria-busy', 'false');
    type(/Access token/, 'EAAG-fake-token');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(form).toHaveAttribute('aria-busy', 'true');
    await waitFor(() => expect(form).toHaveAttribute('aria-busy', 'false'));
  });

  it('keeps the switch off, with the reason, until all five values are set', async () => {
    open();
    const toggle = await screen.findByRole('switch', { name: 'WhatsApp' });
    expect(toggle).toBeDisabled();
    expect(screen.getByText(/Save all five values to switch WhatsApp on/)).toBeInTheDocument();
  });

  it('switches on and off through the brain', async () => {
    const bridge = open(stateWith({ set: SET_ALL, complete: true }));
    const toggle = await screen.findByRole('switch', { name: 'WhatsApp' });
    expect(toggle).toBeEnabled();
    fireEvent.click(toggle);
    await waitFor(() => expect(bridge.whatsappChanges).toEqual([{ enabled: true }]));
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'WhatsApp' })).toHaveAttribute(
        'aria-checked',
        'true',
      ),
    );
  });

  it('says the bridge state in plain words', async () => {
    open(stateWith({ set: SET_ALL, complete: true, enabled: true, state: 'running' }));
    expect(await screen.findByText('WhatsApp is running.')).toBeInTheDocument();
  });

  it('shows one fixed line when saving fails, and keeps what was typed', async () => {
    const bridge = createFakeHostBridge({ bodies: stateWith() });
    bridge.whatsappFails = 'Scout could not save: EAAG-fake-token';
    render(
      <HostBridgeProvider bridge={bridge}>
        <BodiesPanel />
      </HostBridgeProvider>,
    );
    await screen.findByLabelText(/Access token/);
    type(/Access token/, 'EAAG-fake-token');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Scout could not save the WhatsApp settings.');
    expect(document.body.textContent).not.toContain('Scout could not save:');
    expect(screen.getByLabelText(/Access token/)).toHaveValue('EAAG-fake-token');
  });

  it('reads again when the brain says bodies changed', async () => {
    const bridge = open();
    await screen.findByRole('list', { name: 'Bodies' });
    bridge.bodies = stateWith({}, ['desktop', 'whatsapp']);
    act(() => bridge.emitChanged('bodies'));
    await waitFor(() => {
      const list = screen.getByRole('list', { name: 'Bodies' });
      expect(list.querySelectorAll('li')[2]).toHaveTextContent('Connected');
    });
  });
});
