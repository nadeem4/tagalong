/**
 * Tests for DevicesView: this computer (marked when it holds the brain), the paired computers,
 * browsers and AI tools in their own counted groups with rename and revoke, and pairing another
 * device.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HostBridgeProvider } from '../host-bridge';
import type { BrainCard } from '../host-bridge';
import type { BodiesState, DevicesState } from '../shapes';
import { createFakeHostBridge } from '../test-support/fake-host-bridge';
import type { FakeHostBridge } from '../test-support/fake-host-bridge';
import { DevicesView } from './devices-view';

const BRAIN: BrainCard = {
  status: 'running',
  update: 'none',
  version: '0.9.2',
  build: null,
  model: null,
  appVersion: '0.9.2',
  appBuild: 'a1b2c3d',
  startedAt: null,
  startedBy: 'desktop',
  addr: '127.0.0.1:47321',
  pid: 1,
  dataDir: 'C:\tagalong',
  logPath: 'C:\tagalong\brain.log',
  places: [],
  workRunning: false,
};

function stateWith(
  connected = ['desktop'],
  whatsapp: Partial<BodiesState['whatsapp']> = {},
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
  brainHere = false,
): FakeHostBridge {
  const bridge = createFakeHostBridge({
    bodies,
    devices,
    ...(brainHere ? { brainCard: { ...BRAIN, local: true } } : {}),
  });
  render(
    <HostBridgeProvider bridge={bridge}>
      <DevicesView />
    </HostBridgeProvider>,
  );
  return bridge;
}

/** The row for one place, found by its name. */
const row = (name: string) => screen.getByText(name).closest('li') as HTMLElement;

const SET_ALL = {
  accessToken: true,
  appSecret: true,
  verifyToken: true,
  phoneNumberId: true,
  allowedNumber: true,
};

/** WhatsApp's setup is under its row; open it. */
async function openSetup(): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: /^(Set up|Settings)$/ }));
}

const type = (label: RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

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
  name: 'cursor',
  kind: 'mcp_client',
  pairedAt: '2026-11-15T09:00:00Z',
  lastSeen: null,
};
describe('DevicesView', () => {
  it('says what the page is for and offers the next step when nothing is paired', async () => {
    open();
    await screen.findByText('This PC');
    expect(screen.getByRole('heading', { level: 1, name: 'Devices' })).toBeInTheDocument();
    expect(
      screen.getByText('Everything that can talk to Scout, and where its brain lives.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Only this computer so far')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reach Scout away from home' })).toBeEnabled();
    expect(screen.getAllByRole('button', { name: 'Pair a device' })).toHaveLength(1);
  });

  it('counts the paired devices in each group', async () => {
    open(stateWith(), { devices: [CHROME], aiTools: [CURSOR] });
    await screen.findByText('Chrome on laptop');
    expect(screen.getByRole('region', { name: 'Computers and browsers' })).toHaveTextContent(
      '1 paired',
    );
    expect(screen.getByRole('region', { name: 'AI tools' })).toHaveTextContent('1 paired');
    expect(screen.getAllByRole('button', { name: 'Pair a device' })).toHaveLength(1);
  });

  it('marks this computer as the brain when it runs here, and shows its standing', async () => {
    open(stateWith([]), { devices: [], aiTools: [] }, true);
    await screen.findByText('This PC');
    expect(row('This PC')).toHaveTextContent("Scout's brain");
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
    expect(row('Office PC')).toHaveTextContent('Online');
    expect(row('Laptop')).toHaveTextContent('Online');
  });

  it('Get the add-on opens the tour at its Browser step, until the add-on is connected', async () => {
    const bridge = open();
    fireEvent.click(await screen.findByRole('button', { name: 'Get the add-on' }));
    expect(bridge.walkthroughOpens).toEqual([8]);
    cleanup();
    open(stateWith(['desktop', 'browser']));
    await screen.findByText('Chrome add-on');
    expect(screen.queryByRole('button', { name: 'Get the add-on' })).not.toBeInTheDocument();
  });

  describe('paired devices and AI tools', () => {
    const online = (deviceId: string): BodiesState => {
      const state = stateWith();
      state.bodies = [
        {
          id: 'desktop-x',
          kind: 'desktop',
          name: 'Whatever it calls itself',
          connected: true,
          device_id: deviceId,
        },
        ...state.bodies.filter((b) => b.kind !== 'desktop'),
      ];
      return state;
    };

    it('lists a paired device with Online now when it is connected, and an AI tool in its own group', async () => {
      open(online('d1'), { devices: [LAPTOP, CHROME], aiTools: [CURSOR] });
      await screen.findByText('Chrome on laptop');
      expect(row("Nadeem's laptop")).toHaveTextContent('Online now');
      expect(row("Nadeem's laptop")).toHaveTextContent('Desktop · paired');
      expect(row('Chrome on laptop')).toHaveTextContent('Last seen');
      expect(screen.getByRole('region', { name: 'AI tools' })).toContainElement(row('Cursor'));
      expect(row('Cursor')).toHaveTextContent("Reads and adds to Scout's memory");
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

    it('revoking an AI tool removes it from the list', async () => {
      const bridge = open(stateWith(), { devices: [], aiTools: [CURSOR] });
      await screen.findByText('Cursor');
      fireEvent.click(within(row('Cursor')).getByRole('button', { name: 'Revoke' }));
      fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Revoke' }));
      await waitFor(() => expect(screen.queryByText('Cursor')).not.toBeInTheDocument());
      expect(bridge.deviceCalls).toEqual(['revoke d3']);
    });

    it('Connect another AI tool opens its dialog even with none connected, and Done lists the new tool', async () => {
      const bridge = open();
      fireEvent.click(await screen.findByRole('button', { name: 'Connect another AI tool' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Set it up' }));
      bridge.devices = { devices: [], aiTools: [CURSOR] };
      fireEvent.click(await screen.findByRole('button', { name: 'Done' }));
      expect(await screen.findByRole('region', { name: 'AI tools' })).toContainElement(
        row('Cursor'),
      );
      expect(screen.queryByRole('dialog')).toBeNull();
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

    it('names a newly connected AI tool, not its id', async () => {
      const bridge = open(stateWith(), { devices: [], aiTools: [] });
      await screen.findByText('This PC');
      bridge.devices = { devices: [], aiTools: [{ ...CURSOR, name: 'claude-code' }] };
      act(() => bridge.emitChanged('bodies'));
      expect(await screen.findByRole('status')).toHaveTextContent('Claude Code is paired.');
    });

    it('Pair a device opens the pairing dialog with a fresh code', async () => {
      open();
      fireEvent.click((await screen.findAllByRole('button', { name: 'Pair a device' }))[0]!);
      expect(await screen.findByRole('img', { name: 'Pairing QR code' })).toBeInTheDocument();
    });

    it('drops the New chip and the joined line once the new device is seen online', async () => {
      const bridge = open(stateWith(), { devices: [CHROME], aiTools: [] });
      await screen.findByText('Chrome on laptop');
      bridge.devices = { devices: [CHROME, LAPTOP], aiTools: [] };
      act(() => bridge.emitChanged('bodies'));
      expect(await screen.findByRole('status')).toBeInTheDocument();
      bridge.bodies = online('d1');
      act(() => bridge.emitChanged('bodies'));
      await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
      expect(row("Nadeem's laptop")).not.toHaveTextContent('New');
    });

    it('puts the row back and says so when a revoke is refused', async () => {
      const bridge = open(stateWith(), { devices: [CHROME], aiTools: [] });
      bridge.revokeDevice = () => Promise.reject(new Error('offline'));
      await screen.findByText('Chrome on laptop');
      fireEvent.click(within(row('Chrome on laptop')).getByRole('button', { name: 'Revoke' }));
      fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Revoke' }));
      expect(await screen.findByText('Scout could not revoke Chrome on laptop.')).toBeVisible();
      expect(row('Chrome on laptop')).toBeInTheDocument();
    });
  });

  describe('WhatsApp card', () => {
    it('shows Not set up, then Offline once its values are saved, then Online when it is', async () => {
      open();
      await screen.findByText('WhatsApp');
      expect(row('WhatsApp')).toHaveTextContent('Not set up');
      cleanup();
      open(stateWith(['desktop'], { set: SET_ALL, complete: true }));
      await screen.findByText('WhatsApp');
      expect(row('WhatsApp')).toHaveTextContent('Offline');
      cleanup();
      open(stateWith(['desktop', 'whatsapp'], { set: SET_ALL, complete: true, enabled: true }));
      await screen.findByText('WhatsApp');
      expect(row('WhatsApp')).toHaveTextContent('Online');
    });

    it('keeps the setup closed until Set up is pressed', async () => {
      open();
      await screen.findByText('WhatsApp');
      expect(screen.queryByLabelText(/Access token/)).not.toBeInTheDocument();
      await openSetup();
      expect(screen.getByLabelText(/Access token/)).toBeInTheDocument();
    });

    it('shows a saved value as Saved and never its value', async () => {
      open(stateWith(undefined, { set: { ...SET_ALL, verifyToken: false } }));
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
      const bridge = open(stateWith(undefined, { set: SET_ALL, complete: true }));
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
        stateWith(['desktop', 'whatsapp'], {
          set: SET_ALL,
          complete: true,
          enabled: true,
          state: 'running',
        }),
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
    await screen.findByText('Chrome add-on');
    bridge.bodies = stateWith(['desktop', 'browser']);
    act(() => bridge.emitChanged('bodies'));
    await waitFor(() => expect(row('Chrome add-on')).toHaveTextContent('Online'));
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
