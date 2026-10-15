import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Expert, RoutineProposedParams, RoutineView } from '@tagalong/protocol';
import { HostBridgeProvider } from '../host-bridge';
import { createFakeHostBridge, type FakeHostBridge } from '../test-support/fake-host-bridge';
import { RoutinesPanel } from './routines-panel';

const CLAUDE: Expert = {
  id: 'claude-code',
  name: 'Claude Code',
  goodAt: '',
  enabled: true,
  instructions: '',
  connection: { type: 'claude-code', canEdit: false, canSearchWeb: false },
};

const PAPERS: RoutineView = {
  id: '50000000-0000-4000-8000-000000000001',
  name: 'Morning papers',
  enabled: true,
  when: { type: 'schedule', days: [1, 2, 3, 4, 5], time: '08:00' },
  what: 'Find new papers.',
  topics: 'AI agents',
  deliver: { bubble: true, voice: false, notification: false },
  uses: [],
  createdAt: '2026-10-13T07:00:00.000Z',
  lastRunAt: '2026-10-13T07:00:00.000Z',
  lastState: 'done',
  lastActivityId: 'activity-1',
  nextRunAt: '2026-10-14T07:00:00.000Z',
};

async function renderPanel(
  bridge: FakeHostBridge,
  props: { draft?: RoutineProposedParams; onOpenActivity?: () => void } = {},
) {
  render(
    <HostBridgeProvider bridge={bridge}>
      <RoutinesPanel {...props} />
    </HostBridgeProvider>,
  );
  await waitFor(() => expect(screen.queryByText('Loading routines…')).not.toBeInTheDocument());
}

const flush = () => act(async () => await Promise.resolve());

describe('RoutinesPanel', () => {
  it('says there are none yet, with a way to make one', async () => {
    await renderPanel(createFakeHostBridge());
    expect(screen.getByText(/No routines yet/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New routine' })).toBeInTheDocument();
  });

  it('lists each with its switch, when, last run and next run', async () => {
    const onOpenActivity = vi.fn();
    const bridge = createFakeHostBridge({ routines: [PAPERS] });
    await renderPanel(bridge, { onOpenActivity });
    const row = screen.getByRole('listitem');
    expect(row).toHaveTextContent('Morning papers');
    expect(row).toHaveTextContent('Weekdays at 08:00');
    expect(row).toHaveTextContent(/Last run: done/i);
    expect(row).toHaveTextContent(/Next:/);

    fireEvent.click(within(row).getByRole('switch', { name: 'Morning papers' }));
    await flush();
    expect(bridge.routines[0]?.enabled).toBe(false);

    fireEvent.click(within(row).getByRole('button', { name: 'See in Activity' }));
    expect(onOpenActivity).toHaveBeenCalled();

    fireEvent.click(within(row).getByRole('button', { name: 'Run now' }));
    await flush();
    expect(bridge.ranRoutines).toEqual([PAPERS.id]);
  });

  it('starts Morning papers from its template, with topics and a read-only hand-off', async () => {
    const bridge = createFakeHostBridge({ experts: [CLAUDE] });
    await renderPanel(bridge);
    fireEvent.click(screen.getByRole('button', { name: 'New routine' }));
    fireEvent.click(screen.getByRole('button', { name: /Morning papers/ }));
    await flush();
    expect(screen.getByLabelText('Name')).toHaveValue('Morning papers');
    expect(screen.getByLabelText('When')).toHaveValue('weekdays');
    expect(screen.getByLabelText('At')).toHaveValue('08:00');
    expect(screen.getByLabelText('May hand to')).toHaveValue('claude-code');
    fireEvent.change(screen.getByLabelText('Topics'), { target: { value: 'AI agents' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Read aloud' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await flush();
    expect(bridge.routines).toHaveLength(1);
    expect(bridge.routines[0]).toMatchObject({
      name: 'Morning papers',
      when: { type: 'schedule', days: [1, 2, 3, 4, 5], time: '08:00' },
      topics: 'AI agents',
      handTo: 'claude-code',
      deliver: { bubble: true, voice: true, notification: false },
    });
    expect(bridge.routines[0]?.what).toMatch(/title and one line on why it matters/);
  });

  it('starts What needs me from its template, across GitHub, Linear and Notion', async () => {
    const bridge = createFakeHostBridge();
    await renderPanel(bridge);
    fireEvent.click(screen.getByRole('button', { name: 'New routine' }));
    fireEvent.click(screen.getByRole('button', { name: /What needs me/ }));
    await flush();
    expect(screen.getByLabelText('Name')).toHaveValue('What needs me');
    expect(screen.getByLabelText('When')).toHaveValue('weekdays');
    expect(screen.getByLabelText('At')).toHaveValue('09:00');
    expect(screen.getByLabelText('What')).toHaveValue(
      'List what is waiting on me across my connected apps: reviews requested, issues assigned ' +
        'to me, mentions. One line each, oldest first.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await flush();
    expect(bridge.routines[0]).toMatchObject({
      name: 'What needs me',
      when: { type: 'schedule', days: [1, 2, 3, 4, 5], time: '09:00' },
      uses: ['GitHub', 'Linear', 'Notion'],
    });
    expect(bridge.routines[0]?.handTo).toBeUndefined();
  });

  it('offers the other templates and Blank', async () => {
    await renderPanel(createFakeHostBridge());
    fireEvent.click(screen.getByRole('button', { name: 'New routine' }));
    for (const name of [
      /Today’s calendar/,
      /Reviews waiting on GitHub/,
      /What needs me/,
      /End-of-day summary/,
      /Blank/,
    ]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('makes a blank one that runs when an app appears, on chosen days not needed', async () => {
    const bridge = createFakeHostBridge();
    await renderPanel(bridge);
    fireEvent.click(screen.getByRole('button', { name: 'New routine' }));
    fireEvent.click(screen.getByRole('button', { name: /Blank/ }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Mail' } });
    fireEvent.change(screen.getByLabelText('When'), { target: { value: 'app' } });
    expect(screen.queryByLabelText('At')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('App or site'), { target: { value: 'Outlook' } });
    fireEvent.change(screen.getByLabelText('What'), { target: { value: 'Sum up new mail.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await flush();
    expect(bridge.routines[0]).toMatchObject({
      name: 'Mail',
      when: { type: 'app', match: 'Outlook' },
      what: 'Sum up new mail.',
    });
    expect(bridge.routines[0]?.handTo).toBeUndefined();
  });

  it('picks days by hand for a weekly one, and says what is missing', async () => {
    const bridge = createFakeHostBridge();
    await renderPanel(bridge);
    fireEvent.click(screen.getByRole('button', { name: 'New routine' }));
    fireEvent.click(screen.getByRole('button', { name: /Blank/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await flush();
    expect(screen.getByRole('alert')).toHaveTextContent(/name/i);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Review' } });
    fireEvent.change(screen.getByLabelText('What'), { target: { value: 'Plan the week.' } });
    fireEvent.change(screen.getByLabelText('When'), { target: { value: 'days' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mon' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fri' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await flush();
    expect(bridge.routines[0]?.when).toEqual({ type: 'schedule', days: [1, 5], time: '09:00' });
  });

  it('edits and deletes one, deleting only on the second press', async () => {
    const bridge = createFakeHostBridge({ routines: [PAPERS] });
    await renderPanel(bridge);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Morning papers' }));
    expect(screen.getByLabelText('Topics')).toHaveValue('AI agents');
    fireEvent.click(screen.getByRole('button', { name: 'Delete Morning papers' }));
    expect(bridge.routines).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Delete Morning papers for good' }));
    await flush();
    expect(bridge.routines).toEqual([]);
  });

  it('opens Scout’s card in the form, and saves it through the card', async () => {
    const bridge = createFakeHostBridge();
    const draft: RoutineProposedParams = {
      proposalId: '50000000-0000-4000-8000-0000000000aa',
      petId: 'scout',
      action: 'create',
      routine: {
        name: 'Calendar',
        enabled: true,
        when: { type: 'schedule', days: [0, 1, 2, 3, 4, 5, 6], time: '07:30' },
        what: 'Tell me my day.',
        topics: '',
        deliver: { bubble: true, voice: false, notification: true },
        uses: [],
      },
    };
    await renderPanel(bridge, { draft });
    expect(screen.getByLabelText('Name')).toHaveValue('Calendar');
    expect(screen.getByLabelText('When')).toHaveValue('daily');
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'My day' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await flush();
    expect(bridge.confirmedRoutines).toEqual([
      expect.objectContaining({
        proposalId: draft.proposalId,
        routine: expect.objectContaining({ name: 'My day' }),
      }),
    ]);
    expect(bridge.routines).toEqual([]);
  });

  it('lists again when the routines change', async () => {
    const bridge = createFakeHostBridge();
    await renderPanel(bridge);
    bridge.routines.push(PAPERS);
    act(() => bridge.emit({ type: 'routines.changed' }));
    await waitFor(() => expect(screen.getByText('Morning papers')).toBeInTheDocument());
  });

  it('starts Meeting prep from its template and keeps the calendar link apart from the routine', async () => {
    const bridge = createFakeHostBridge();
    await renderPanel(bridge);
    fireEvent.click(screen.getByRole('button', { name: 'New routine' }));
    fireEvent.click(screen.getByRole('button', { name: /Meeting prep/ }));
    await flush();
    expect(screen.getByLabelText('When')).toHaveValue('meeting');
    expect(screen.getByLabelText('Minutes before')).toHaveValue('10');
    expect(screen.queryByLabelText('At')).not.toBeInTheDocument();
    expect(screen.getByText(/Secret address in iCal format/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await flush();
    expect(screen.getByRole('alert')).toHaveTextContent(/calendar link/i);
    expect(bridge.routines).toEqual([]);

    const link = 'https://calendar.example.com/private-abc/basic.ics';
    fireEvent.change(screen.getByLabelText('Calendar link (.ics)'), { target: { value: link } });
    fireEvent.change(screen.getByLabelText('Minutes before'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await flush();
    expect(bridge.calendarLinks).toEqual([link]);
    expect(bridge.routines[0]).toMatchObject({
      name: 'Meeting prep',
      when: { type: 'meeting', minutesBefore: 30 },
    });
    expect(bridge.routines[0]?.what).toMatch(/agenda/i);
    expect(JSON.stringify(bridge.routines[0])).not.toContain(link);
  });

  it('needs no new link once one is kept', async () => {
    const bridge = createFakeHostBridge({ calendar: { linked: true, meetings: 2 } });
    await renderPanel(bridge);
    fireEvent.click(screen.getByRole('button', { name: 'New routine' }));
    fireEvent.click(screen.getByRole('button', { name: /Meeting prep/ }));
    await flush();
    expect(screen.getByText(/kept in your keychain/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await flush();
    expect(bridge.calendarLinks).toEqual([]);
    expect(bridge.routines).toHaveLength(1);
  });

  it('forgets the kept link on request', async () => {
    const bridge = createFakeHostBridge({ calendar: { linked: true, meetings: 2 } });
    await renderPanel(bridge);
    fireEvent.click(screen.getByRole('button', { name: 'New routine' }));
    fireEvent.click(screen.getByRole('button', { name: /Meeting prep/ }));
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Forget the link' }));
    await flush();
    expect(bridge.calendarLinks).toEqual([null]);
    expect(screen.queryByRole('button', { name: 'Forget the link' })).not.toBeInTheDocument();
  });

  it('shows what is wrong with the calendar on the routine’s row', async () => {
    const prep: RoutineView = {
      ...PAPERS,
      id: '50000000-0000-4000-8000-000000000002',
      name: 'Meeting prep',
      when: { type: 'meeting', minutesBefore: 10 },
      problem: 'Could not read your calendar: the calendar host answered 404.',
    };
    await renderPanel(createFakeHostBridge({ routines: [prep] }));
    const row = screen.getByRole('listitem');
    expect(row).toHaveTextContent('10 min before each meeting');
    expect(row).toHaveTextContent('the calendar host answered 404');
  });
});
