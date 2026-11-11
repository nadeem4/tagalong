/**
 * Tests for PlacesView: the three places you can talk to Scout (this PC, the browser add-on,
 * WhatsApp) with their state, and the WhatsApp setup kept under its row (five fields, the switch,
 * Save). A saved secret shows only the word Saved; a typed one is cleared after a save.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HostBridgeProvider } from '../host-bridge';
import type { BodiesState } from '../shapes';
import { createFakeHostBridge } from '../test-support/fake-host-bridge';
import type { FakeHostBridge } from '../test-support/fake-host-bridge';
import { PlacesView } from './places-view';

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
      <PlacesView />
    </HostBridgeProvider>,
  );
  return bridge;
}

/** The row for one place, found by its name. */
const row = (name: string) => screen.getByText(name).closest('li') as HTMLElement;

/** WhatsApp's setup is under its row; open it. */
async function openSetup(): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: /^(Set up|Settings)$/ }));
}

const type = (label: RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('PlacesView', () => {
  it('says what the page is for', async () => {
    open();
    expect(
      await screen.findByText(
        'The places you can talk to Scout. Each one is the same Scout and the same conversation.',
      ),
    ).toBeInTheDocument();
  });

  it('lists This PC, the browser add-on and WhatsApp, each with a purpose line', async () => {
    open();
    await screen.findByText('This PC');
    expect(row('This PC')).toHaveTextContent('Desktop');
    expect(row('This PC')).toHaveTextContent(
      'Scout sits on your screen, reads what you point it at and talks out loud.',
    );
    expect(row('Chrome add-on')).toHaveTextContent(
      'Scout reads the page you are on, and you can talk to it from the toolbar.',
    );
    expect(row('WhatsApp')).toHaveTextContent(
      'Message Scout from your phone. It answers in the same chat.',
    );
  });

  it('shows Connected for a connected place and Not set up for one that never was', async () => {
    open(stateWith({}, ['desktop']));
    await screen.findByText('This PC');
    expect(row('This PC')).toHaveTextContent('Connected');
    expect(row('Chrome add-on')).toHaveTextContent('Not set up');
    expect(row('WhatsApp')).toHaveTextContent('Not set up');
  });

  it('shows Connected for the add-on and WhatsApp when they are', async () => {
    open(
      stateWith({ set: SET_ALL, complete: true, enabled: true }, [
        'desktop',
        'browser',
        'whatsapp',
      ]),
    );
    await screen.findByText('This PC');
    expect(row('Chrome add-on')).toHaveTextContent('Connected');
    expect(row('WhatsApp')).toHaveTextContent('Connected');
  });

  it('shows WhatsApp as Offline when its values are saved but it is not connected', async () => {
    open(stateWith({ set: SET_ALL, complete: true, enabled: false }));
    await screen.findByText('This PC');
    expect(row('WhatsApp')).toHaveTextContent('Offline');
    expect(within(row('WhatsApp')).getByRole('button', { name: 'Set up' })).toBeInTheDocument();
  });

  it('shows This PC as Offline when the desktop is not connected', async () => {
    open(stateWith({}, []));
    await screen.findByText('This PC');
    expect(row('This PC')).toHaveTextContent('Offline');
  });

  it('Get the add-on opens the tour at its Browser step', async () => {
    const bridge = open();
    fireEvent.click(await screen.findByRole('button', { name: 'Get the add-on' }));
    expect(bridge.walkthroughOpens).toEqual([7]);
  });

  it('has no add-on button once the add-on is connected', async () => {
    open(stateWith({}, ['desktop', 'browser']));
    await screen.findByText('This PC');
    expect(screen.queryByRole('button', { name: 'Get the add-on' })).not.toBeInTheDocument();
  });

  it('keeps WhatsApp setup closed until Set up is pressed', async () => {
    open();
    await screen.findByText('WhatsApp');
    expect(screen.queryByLabelText(/Access token/)).not.toBeInTheDocument();
    await openSetup();
    expect(screen.getByLabelText(/Access token/)).toBeInTheDocument();
  });

  describe('WhatsApp keeps its setup flow', () => {
    it('shows a saved value as Saved and never its value', async () => {
      open(stateWith({ set: { ...SET_ALL, verifyToken: false } }));
      await openSetup();
      const field = screen.getByLabelText(/Access token/);
      expect(field).toHaveValue('');
      expect(field).toHaveAttribute('type', 'password');
      expect(field).toHaveAttribute('placeholder', 'Saved');
      expect(screen.getByLabelText(/Verify token/)).toHaveAttribute('placeholder', '');
    });

    it('saves only the fields typed, then clears them', async () => {
      const bridge = open();
      await openSetup();
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
      await openSetup();
      const form = screen.getByLabelText(/Access token/).closest('form')!;
      expect(form).toHaveAttribute('aria-busy', 'false');
      type(/Access token/, 'EAAG-fake-token');
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      expect(form).toHaveAttribute('aria-busy', 'true');
      await waitFor(() => expect(form).toHaveAttribute('aria-busy', 'false'));
    });

    it('keeps the switch off, with the reason, until all five values are set', async () => {
      open();
      await openSetup();
      expect(screen.getByRole('switch', { name: 'WhatsApp' })).toBeDisabled();
      expect(
        screen.getByText('WhatsApp is waiting for all five values. Save all five to switch it on.'),
      ).toBeInTheDocument();
    });

    it('switches on through the brain', async () => {
      const bridge = open(stateWith({ set: SET_ALL, complete: true }));
      await openSetup();
      const toggle = screen.getByRole('switch', { name: 'WhatsApp' });
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
      open(
        stateWith({ set: SET_ALL, complete: true, enabled: true, state: 'running' }, [
          'desktop',
          'whatsapp',
        ]),
      );
      await openSetup();
      expect(screen.getByText('WhatsApp is running.')).toBeInTheDocument();
    });

    it('shows one fixed line when saving fails, and keeps what was typed', async () => {
      const bridge = createFakeHostBridge({ bodies: stateWith() });
      bridge.whatsappFails = 'Scout could not save: EAAG-fake-token';
      render(
        <HostBridgeProvider bridge={bridge}>
          <PlacesView />
        </HostBridgeProvider>,
      );
      await openSetup();
      type(/Access token/, 'EAAG-fake-token');
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('Scout could not save the WhatsApp settings.');
      expect(document.body.textContent).not.toContain('Scout could not save:');
      expect(screen.getByLabelText(/Access token/)).toHaveValue('EAAG-fake-token');
    });

    it('has just one Save in the setup, no Close', async () => {
      open();
      await openSetup();
      expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
    });
  });

  it('reads again when the brain says bodies changed', async () => {
    const bridge = open();
    await screen.findByText('WhatsApp');
    expect(row('WhatsApp')).toHaveTextContent('Not set up');
    bridge.bodies = stateWith({ set: SET_ALL, complete: true, enabled: true }, [
      'desktop',
      'whatsapp',
    ]);
    act(() => bridge.emitChanged('bodies'));
    await waitFor(() => expect(row('WhatsApp')).toHaveTextContent('Connected'));
  });

  it('says so when the brain cannot be read', async () => {
    const bridge = createFakeHostBridge();
    bridge.bodiesState = () => Promise.reject(new Error('offline'));
    render(
      <HostBridgeProvider bridge={bridge}>
        <PlacesView />
      </HostBridgeProvider>,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Tagalong could not read this. It loads again when Home reopens.',
    );
  });
});
