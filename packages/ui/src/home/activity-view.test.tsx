/** Tests for ActivityView: entries, threads, paging and refresh. */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ActivityEntry } from '@tagalong/protocol';
import { HostBridgeProvider } from '../host-bridge';
import { createFakeHostBridge, type FakeHostBridge } from '../test-support/fake-host-bridge';
import { ActivityView } from './activity-view';

const T1 = '10000000-0000-4000-8000-000000000001';
const T2 = '10000000-0000-4000-8000-000000000002';
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
const HANDED = entry({
  id: 'e2',
  kind: 'expert',
  expertId: 'claude-code',
  expertName: 'Claude Code',
  text: 'Fix the failing test',
});

async function renderActivity(bridge: FakeHostBridge) {
  render(
    <HostBridgeProvider bridge={bridge}>
      <ActivityView name="Scout" />
    </HostBridgeProvider>,
  );
  return screen.findByRole('list', { name: 'Activity' }).catch(() => null);
}

const row = (name: RegExp) => screen.getByRole('button', { name });

describe('ActivityView', () => {
  it('lists turns and hand-offs, newest first, in words', async () => {
    const bridge = createFakeHostBridge({ activity: [HANDED, TURN] });
    await renderActivity(bridge);
    const list = screen.getByRole('list', { name: 'Activity' });
    const lines = within(list)
      .getAllByRole('button')
      .map((button) => button.textContent ?? '');
    expect(lines[0]).toContain('Scout handed off to Claude Code');
    expect(lines[1]).toContain('Scout answered');
    expect(lines[1]).toContain('fake-model');
    expect(lines[1]).toContain('3 calls');
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

  it('shows a brief handed to an expert, its answer and the files it changed', async () => {
    const handed = entry({
      id: 'x1',
      kind: 'expert',
      expertId: 'claude-code',
      expertName: 'Claude Code',
      text: 'Fix the failing test',
      answer: 'Fixed the import.',
      changedFiles: ['src/a.ts'],
    });
    await renderActivity(createFakeHostBridge({ activity: [handed] }));
    fireEvent.click(row(/Scout handed off to Claude Code/));
    const thread = screen.getByRole('region', { name: 'Scout handed off to Claude Code' });
    expect(thread).toHaveTextContent('Fix the failing test');
    expect(thread).toHaveTextContent('Claude Code answered');
    expect(thread).toHaveTextContent('Fixed the import.');
    expect(thread).toHaveTextContent('src/a.ts');
  });

  it('names each call to a connected app: which app, which tool, read or change', async () => {
    const call = (fields: Partial<ActivityEntry>) =>
      entry({ id: String(fields.tool), kind: 'connector', app: 'Notion', ...fields });
    await renderActivity(
      createFakeHostBridge({
        activity: [
          call({ tool: 'search', access: 'read' }),
          call({ tool: 'create_page', access: 'write' }),
          call({ tool: 'update_page', access: 'write', state: 'stopped' }),
          call({ tool: 'fetch', access: 'read', state: 'error', error: 'Notion did not answer.' }),
        ],
      }),
    );
    expect(row(/Scout read Notion/)).toHaveTextContent('search');
    expect(row(/Scout changed Notion/)).toHaveTextContent('create_page');
    expect(row(/Scout did not change Notion/)).toHaveTextContent('Stopped');
    expect(row(/Scout could not reach Notion/)).toHaveTextContent('Failed');
  });

  it('names each routine run, and one that failed', async () => {
    await renderActivity(
      createFakeHostBridge({
        activity: [
          entry({ id: 'p', kind: 'routine', text: 'Morning papers', answer: 'Two new papers.' }),
          entry({ id: 'q', kind: 'routine', text: 'Calendar', state: 'error', error: 'No key.' }),
        ],
      }),
    );
    expect(row(/Scout ran Morning papers/)).toHaveTextContent('Done');
    expect(row(/Calendar did not run/)).toHaveTextContent('Failed');
  });

  it('pairs every state with a word: working, done, failed', async () => {
    await renderActivity(
      createFakeHostBridge({
        activity: [
          entry({ id: 'r', kind: 'turn', state: 'running' }),
          entry({ id: 'f', kind: 'turn', state: 'error', error: 'No key.' }),
        ],
      }),
    );
    expect(row(/Scout is answering/)).toHaveTextContent('Working');
    expect(row(/Scout could not answer/)).toHaveTextContent('Failed');
  });

  it('updates live when the engine reports a turn', async () => {
    const bridge = createFakeHostBridge({ activity: [TURN] });
    await renderActivity(bridge);
    bridge.activity.unshift(entry({ id: 'new', kind: 'turn', state: 'running' }));
    await act(async () => {
      bridge.emit({ type: 'turn.started', turnId: T2, petId: 'scout', conversationId: T2 });
      await Promise.resolve();
    });
    expect(await screen.findByRole('button', { name: /Scout is answering/ })).toBeInTheDocument();
    expect(row(/Scout answered/)).toBeInTheDocument();
  });

  it('updates live when an expert finishes a hand-off', async () => {
    const running = entry({
      id: 'x',
      kind: 'expert',
      state: 'running',
      expertId: 'claude-code',
      expertName: 'Claude Code',
    });
    const bridge = createFakeHostBridge({ activity: [running] });
    await renderActivity(bridge);
    expect(row(/Scout handed off to Claude Code/)).toHaveTextContent('Working');
    bridge.activity[0] = { ...running, state: 'done', answer: 'Done.' };
    await act(async () => {
      bridge.emit({
        type: 'handoff.finished',
        handoffId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
        expertId: 'claude-code',
        state: 'done',
        text: 'Done.',
      });
      await Promise.resolve();
    });
    await waitFor(() => expect(row(/Scout handed off to Claude Code/)).toHaveTextContent('Done'));
  });

  it('updates live when a routine run ends with nothing to deliver', async () => {
    // A quiet run sends no routine.result; routines.changed is all the engine says.
    const running = entry({ id: 'r', kind: 'routine', state: 'running', text: 'Morning papers' });
    const bridge = createFakeHostBridge({ activity: [running] });
    await renderActivity(bridge);
    expect(row(/Scout is running Morning papers/)).toHaveTextContent('Working');
    bridge.activity[0] = { ...running, state: 'done', answer: '' };
    await act(async () => {
      bridge.emit({ type: 'routines.changed' });
      await Promise.resolve();
    });
    await waitFor(() => expect(row(/Scout ran Morning papers/)).toHaveTextContent('Done'));
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
        <ActivityView name="Scout" />
      </HostBridgeProvider>,
    );
    expect(await screen.findByText(/Nothing yet/)).toBeInTheDocument();
  });

  it('says so in a host that keeps no activity', () => {
    const bridge = createFakeHostBridge();
    delete (bridge as { listActivity?: unknown }).listActivity;
    render(
      <HostBridgeProvider bridge={bridge}>
        <ActivityView name="Scout" />
      </HostBridgeProvider>,
    );
    expect(screen.getByText(/not available here/)).toBeInTheDocument();
  });
});
