/**
 * Tests for DevicesView: this PC, the paired computers, browsers and AI tools with rename and
 * revoke, pairing another device, the browser add-on and WhatsApp with its setup kept under its
 * row (five fields, the switch, Save). A saved secret shows only the word Saved; a typed one is
 * cleared after a save.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HostBridgeProvider } from '../host-bridge';
import type { BodiesState, DevicesState } from '../shapes';
import { createFakeHostBridge } from '../test-support/fake-host-bridge';
import type { FakeHostBridge } from '../test-support/fake-host-bridge';
import { DevicesView } from './devices-view';

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
      id: kind,
      kind,
      name: kind === 'whatsapp' ? 'WhatsApp' : kind === 'desktop' ? 'This PC' : 'Chrome add-on',
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

function open(
  bodies: BodiesState = stateWith(),
  devices: DevicesState = { devices: [], aiTools: [] },
): FakeHostBridge {
  const bridge = createFakeHostBridge({ bodies, devices });
  render(
    <HostBridgeProvider bridge={bridge}>
      <DevicesView />
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

describe('DevicesView', () => {
  it('says what the page is for', async () => {
    open();
    await screen.findByText('This PC');
    expect(
      await screen.findByText('Everything that can talk to Scout, and where its brain lives.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Devices' })).toBeInTheDocument();
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

  it('lists two desktops by name', async () => {
    const state = stateWith();
    state.bodies = [
      { id: 'desktop-aaaaaa', kind: 'desktop', name: 'Office PC', connected: true },
      { id: 'desktop-bbbbbb', kind: 'desktop', name: 'Laptop', connected: true },
      ...state.bodies.filter((b) => b.kind !== 'desktop'),
    ];
    open(state);
    await screen.findByText('Office PC');
    expect(row('Office PC')).toHaveTextContent('Connected');
    expect(row('Laptop')).toHaveTextContent('Connected');
    expect(screen.queryByText('This PC')).not.toBeInTheDocument();
  });

  it('lists two browsers by name and offers no add-on button', async () => {
    const state = stateWith({}, ['desktop']);
    state.bodies = [
      ...state.bodies.filter((b) => b.kind !== 'browser'),
      { id: 'chrome-aaaa', kind: 'browser', name: 'Chrome', connected: true },
      { id: 'edge-bbbb', kind: 'browser', name: 'Edge', connected: true },
    ];
    open(state);
    await screen.findByText('Chrome');
    expect(row('Chrome')).toHaveTextContent('Connected');
    expect(row('Edge')).toHaveTextContent('Connected');
    expect(screen.queryByRole('button', { name: 'Get the add-on' })).not.toBeInTheDocument();
  });

  it('Get the add-on opens the tour at its Browser step', async () => {
    const bridge = open();
    fireEvent.click(await screen.findByRole('button', { name: 'Get the add-on' }));
    expect(bridge.walkthroughOpens).toEqual([8]);
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

  describe('paired devices and AI tools', () => {
    const LAPTOP = {
      id: 'd1',
      name: "Nadeem's laptop",
      kind: 'desktop',
      pairedAt: '2026-11-14T09:00:00Z',
      lastSeen: null,
    };
    const CHROME = {
      id: 'd2',
      name: 'Chrome on laptop',
      kind: 'browser',
      pairedAt: '2026-11-14T09:00:00Z',
      lastSeen: '2026-11-22T18:02:00Z',
    };
    const CURSOR = {
      id: 'd3',
      name: 'Cursor',
      kind: 'mcp_client',
      pairedAt: '2026-11-15T09:00:00Z',
      lastSeen: null,
    };
    const online = (name: string): BodiesState => {
      const state = stateWith();
      state.bodies = [
        { id: 'desktop-x', kind: 'desktop', name, connected: true },
        ...state.bodies.filter((b) => b.kind !== 'desktop'),
      ];
      return state;
    };

    it('lists a paired device with Online now when it is connected, and an AI tool in its own group', async () => {
      open(online("Nadeem's laptop"), { devices: [LAPTOP, CHROME], aiTools: [CURSOR] });
      await screen.findByText('Chrome on laptop');
      expect(row("Nadeem's laptop")).toHaveTextContent('Online now');
      expect(row("Nadeem's laptop")).toHaveTextContent('Desktop · paired 14 Nov');
      expect(row('Chrome on laptop')).toHaveTextContent('Last seen');
      expect(screen.getByRole('region', { name: 'AI tools' })).toContainElement(row('Cursor'));
      expect(row('Cursor')).toHaveTextContent("Reads and adds to Scout's memory");
    });

    it('with nothing paired says so and offers the next step', async () => {
      open();
      expect(await screen.findByText('Only this computer so far')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Reach Scout away from home' })).toBeEnabled();
    });

    it('renames a device in place and Escape cancels', async () => {
      const bridge = open(stateWith(), { devices: [CHROME], aiTools: [] });
      await screen.findByText('Chrome on laptop');
      fireEvent.click(within(row('Chrome on laptop')).getByRole('button', { name: 'Rename' }));
      fireEvent.keyDown(screen.getByRole('textbox', { name: 'Name' }), { key: 'Escape' });
      expect(screen.queryByRole('textbox', { name: 'Name' })).not.toBeInTheDocument();
      fireEvent.click(within(row('Chrome on laptop')).getByRole('button', { name: 'Rename' }));
      fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
        target: { value: 'Work Chrome' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      await screen.findByText('Work Chrome');
      expect(bridge.deviceCalls).toEqual(['rename d2 Work Chrome']);
    });

    it('asks before revoking, Keep it changes nothing, Revoke removes the row', async () => {
      const bridge = open(stateWith(), { devices: [CHROME], aiTools: [] });
      await screen.findByText('Chrome on laptop');
      fireEvent.click(within(row('Chrome on laptop')).getByRole('button', { name: 'Revoke' }));
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Revoke Chrome on laptop? It stops working right away and loses access to Scout. You can pair it again with a new code.',
      );
      fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));
      expect(bridge.deviceCalls).toEqual([]);
      fireEvent.click(within(row('Chrome on laptop')).getByRole('button', { name: 'Revoke' }));
      fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Revoke' }));
      await waitFor(() => expect(screen.queryByText('Chrome on laptop')).not.toBeInTheDocument());
      expect(bridge.deviceCalls).toEqual(['revoke d2']);
    });

    it('revoking an AI tool says what it already added stays', async () => {
      open(stateWith(), { devices: [], aiTools: [CURSOR] });
      await screen.findByText('Cursor');
      fireEvent.click(within(row('Cursor')).getByRole('button', { name: 'Revoke' }));
      expect(screen.getByRole('alert')).toHaveTextContent(
        "Revoke Cursor? It can no longer read or add to Scout's memory. What it already added stays; remove it under What Scout remembers.",
      );
    });

    it('says who joined, with a New chip, when a device pairs while the page is open', async () => {
      const bridge = open(stateWith(), { devices: [CHROME], aiTools: [] });
      await screen.findByText('Chrome on laptop');
      bridge.devices = {
        devices: [CHROME, { ...LAPTOP, name: "Nadeem's phone", lastSeen: '2026-11-23T12:00:00Z' }],
        aiTools: [],
      };
      act(() => bridge.emitChanged('bodies'));
      expect(await screen.findByRole('status')).toHaveTextContent(
        "Nadeem's phone is paired. It can now talk to Scout.",
      );
      expect(row("Nadeem's phone")).toHaveTextContent('New');
    });

    it('Pair a device opens the pairing dialog with a fresh code', async () => {
      open();
      fireEvent.click((await screen.findAllByRole('button', { name: 'Pair a device' }))[0]!);
      expect(await screen.findByRole('img', { name: 'Pairing QR code' })).toBeInTheDocument();
    });

    it('with network access off the dialog offers to turn it on', async () => {
      const bridge = createFakeHostBridge({ bodies: stateWith() });
      bridge.pairError = 'network_off';
      render(
        <HostBridgeProvider bridge={bridge}>
          <DevicesView />
        </HostBridgeProvider>,
      );
      fireEvent.click((await screen.findAllByRole('button', { name: 'Pair a device' }))[0]!);
      const turnOn = await screen.findByRole('button', { name: 'Let other devices connect' });
      bridge.pairError = undefined;
      fireEvent.click(turnOn);
      expect(await screen.findByRole('img', { name: 'Pairing QR code' })).toBeInTheDocument();
      expect(bridge.brainActions).toContain('install-service');
    });
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
          <DevicesView />
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
        <DevicesView />
      </HostBridgeProvider>,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Tagalong could not read this. It loads again when Home reopens.',
    );
  });
});
