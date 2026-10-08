import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ActivityEntry, Pet } from '@tagalong/protocol';
import { HostBridgeProvider } from '../host-bridge';
import { createFakeHostBridge, type FakeHostBridge } from '../test-support/fake-host-bridge';
import { ActivityView } from './activity-view';

const pet = (id: string, name: string): Pet => ({
  id,
  name,
  avatar: '🐾',
  roleId: 'generalist',
  roleVersion: 1,
  model: 'fake',
  providerId: 'fake',
  toolGrants: {},
  replyStyle: 'text',
});
const CREW = [pet('scout', 'Scout'), pet('ink', 'Ink'), pet('bolt', 'Bolt')];
const T1 = '10000000-0000-4000-8000-000000000001';
const T2 = '10000000-0000-4000-8000-000000000002';
const RUN = '10000000-0000-4000-8000-0000000000aa';
const AT = '2026-10-07T10:00:00.000Z';

const entry = (fields: Partial<ActivityEntry> & Pick<ActivityEntry, 'id' | 'kind'>) =>
  ({ state: 'done', petId: 'scout', startedAt: AT, ...fields }) as ActivityEntry;

const TURN = entry({
  id: 'e1',
  kind: 'turn',
  turnId: T1,
  model: 'fake-model',
  modelCalls: 3,
  text: 'What does this error mean?',
  answer: 'The port is taken.',
});
const CONSULT = entry({
  id: 'e2',
  kind: 'consult',
  toPetId: 'bolt',
  turnId: T1,
  text: 'Which port does the engine use?',
  answer: '47321.',
});
const HANDOFF = entry({
  id: 'e3',
  kind: 'handoff',
  toPetId: 'ink',
  turnId: T2,
  text: 'The user wants a reply drafted.',
});
const INK_TURN = entry({ id: 'e4', kind: 'turn', petId: 'ink', turnId: T2, answer: 'Dear team…' });
const TABLE = entry({ id: 'e5', kind: 'roundtable', petId: 'ink', runId: RUN, modelCalls: 4 });
const TABLE_TURNS = [
  entry({ id: 'e6', kind: 'turn', petId: 'bolt', runId: RUN, answer: 'Dock it right.' }),
  entry({ id: 'e7', kind: 'turn', petId: 'ink', runId: RUN, answer: 'Dock it left.' }),
];

async function renderActivity(bridge: FakeHostBridge) {
  render(
    <HostBridgeProvider bridge={bridge}>
      <ActivityView pets={CREW} />
    </HostBridgeProvider>,
  );
  return screen.findByRole('list', { name: 'Activity' }).catch(() => null);
}

const row = (name: RegExp) => screen.getByRole('button', { name });

describe('ActivityView', () => {
  it('lists turns, consults, handoffs and roundtables, newest first, in words', async () => {
    const bridge = createFakeHostBridge({
      activity: [TABLE, INK_TURN, HANDOFF, CONSULT, TURN],
    });
    await renderActivity(bridge);
    const list = screen.getByRole('list', { name: 'Activity' });
    const lines = within(list)
      .getAllByRole('button')
      .map((button) => button.textContent ?? '');
    expect(lines[0]).toContain('Ink started a roundtable');
    expect(lines[1]).toContain('Ink answered');
    expect(lines[2]).toContain('Scout handed off to Ink');
    expect(lines[3]).toContain('Scout asked Bolt');
    expect(lines[4]).toContain('Scout answered');
    expect(lines[4]).toContain('fake-model');
    expect(lines[4]).toContain('3 calls');
    expect(lines[0]).toContain('4 calls');
  });

  it('opens a turn’s thread on click: the question and the answer', async () => {
    await renderActivity(createFakeHostBridge({ activity: [TURN] }));
    const turn = row(/Scout answered/);
    expect(turn).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(turn);
    expect(turn).toHaveAttribute('aria-expanded', 'true');
    const thread = screen.getByRole('region', { name: 'Scout answered' });
    expect(thread).toHaveTextContent('What does this error mean?');
    expect(thread).toHaveTextContent('The port is taken.');
  });

  it('shows who asked whom in a consult, with the question and the answer', async () => {
    await renderActivity(createFakeHostBridge({ activity: [CONSULT] }));
    fireEvent.click(row(/Scout asked Bolt/));
    const thread = screen.getByRole('region', { name: 'Scout asked Bolt' });
    expect(thread).toHaveTextContent('Which port does the engine use?');
    expect(thread).toHaveTextContent('Bolt answered');
    expect(thread).toHaveTextContent('47321.');
  });

  it('shows a handoff’s summary and the answer the other pet gave', async () => {
    await renderActivity(createFakeHostBridge({ activity: [INK_TURN, HANDOFF] }));
    fireEvent.click(row(/Scout handed off to Ink/));
    const thread = screen.getByRole('region', { name: 'Scout handed off to Ink' });
    expect(thread).toHaveTextContent('The user wants a reply drafted.');
    expect(thread).toHaveTextContent('Dear team…');
  });

  it('reads a roundtable as its turns in order', async () => {
    await renderActivity(
      createFakeHostBridge({ activity: [TABLE, ...[...TABLE_TURNS].reverse()] }),
    );
    fireEvent.click(row(/Ink started a roundtable/));
    const thread = screen.getByRole('region', { name: 'Ink started a roundtable' });
    expect(thread.textContent).toMatch(/Bolt.*Dock it right\..*Ink.*Dock it left\./);
  });

  it('pairs every state with a word: working, done, failed', async () => {
    await renderActivity(
      createFakeHostBridge({
        activity: [
          entry({ id: 'r', kind: 'turn', state: 'running' }),
          entry({ id: 'f', kind: 'turn', petId: 'ink', state: 'error', error: 'No key.' }),
        ],
      }),
    );
    expect(row(/Scout is answering/)).toHaveTextContent('Working');
    expect(row(/Ink could not answer/)).toHaveTextContent('Failed');
  });

  it('updates live when the engine reports a turn', async () => {
    const bridge = createFakeHostBridge({ activity: [TURN] });
    await renderActivity(bridge);
    bridge.activity.unshift(entry({ id: 'new', kind: 'turn', petId: 'ink', state: 'running' }));
    await act(async () => {
      bridge.emit({ type: 'turn.started', turnId: T2, petId: 'ink', conversationId: T2 });
      await Promise.resolve();
    });
    expect(await screen.findByRole('button', { name: /Ink is answering/ })).toBeInTheDocument();
    expect(row(/Scout answered/)).toBeInTheDocument();
  });

  it('pages back through older activity', async () => {
    const many = Array.from({ length: 35 }, (_, index) =>
      entry({ id: `m${index}`, kind: 'turn', text: `question ${index}` }),
    );
    await renderActivity(createFakeHostBridge({ activity: many }));
    const list = screen.getByRole('list', { name: 'Activity' });
    expect(within(list).getAllByRole('button')).toHaveLength(30);
    fireEvent.click(screen.getByRole('button', { name: 'Show older' }));
    expect(await screen.findByText('question 34')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show older' })).toBeNull();
  });

  it('says so when nothing has happened yet', async () => {
    render(
      <HostBridgeProvider bridge={createFakeHostBridge()}>
        <ActivityView pets={CREW} />
      </HostBridgeProvider>,
    );
    expect(await screen.findByText(/Nothing yet/)).toBeInTheDocument();
  });

  it('says so in a host that keeps no activity', () => {
    const bridge = createFakeHostBridge();
    delete (bridge as { listActivity?: unknown }).listActivity;
    render(
      <HostBridgeProvider bridge={bridge}>
        <ActivityView pets={CREW} />
      </HostBridgeProvider>,
    );
    expect(screen.getByText(/not available here/)).toBeInTheDocument();
  });
});
