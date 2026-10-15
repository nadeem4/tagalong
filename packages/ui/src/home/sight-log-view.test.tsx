import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SightLogEntry } from '@tagalong/protocol';
import { HostBridgeProvider } from '../host-bridge';
import { createFakeHostBridge, type FakeHostBridge } from '../test-support/fake-host-bridge';
import { SightLogView } from './sight-log-view';

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();

const TODAY_READ: SightLogEntry = {
  id: 'r1',
  kind: 'read_text',
  at: iso(now),
  app: 'Code.exe',
  title: 'main.ts - repo',
  chars: 812,
  source: 'uia',
};
const TODAY_SENT: SightLogEntry = {
  id: 'r2',
  kind: 'sent_to_ai',
  at: iso(now - 1000),
  providerId: 'anthropic',
  model: 'claude-haiku-4-5',
  chars: 900,
  images: 1,
};
const YESTERDAY: SightLogEntry = {
  id: 'r3',
  kind: 'sent_to_expert',
  at: iso(now - DAY),
  expertName: 'Coder',
  chars: 300,
};
const EARLIER: SightLogEntry = {
  id: 'r4',
  kind: 'listed_windows',
  at: iso(now - 4 * DAY),
  windows: 12,
};

function renderLog(bridge: FakeHostBridge) {
  render(
    <HostBridgeProvider bridge={bridge}>
      <SightLogView name="Scout" providerLabel={(id) => (id === 'anthropic' ? 'Anthropic' : id)} />
    </HostBridgeProvider>,
  );
}

describe('SightLogView', () => {
  it('groups rows into Today, Yesterday and Earlier, newest first, with where each went', async () => {
    const bridge = createFakeHostBridge({ sightLog: [TODAY_READ, TODAY_SENT, YESTERDAY, EARLIER] });
    renderLog(bridge);

    const today = await screen.findByRole('list', { name: 'Today' });
    const rows = within(today).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Read text');
    expect(rows[0]).toHaveTextContent('Code.exe · main.ts - repo');
    expect(rows[0]).toHaveTextContent('812 characters');
    expect(rows[1]).toHaveTextContent('Sent to AI');
    expect(rows[1]).toHaveTextContent('Anthropic · claude-haiku-4-5');
    expect(rows[1]).toHaveTextContent('1 picture');

    const yesterday = screen.getByRole('list', { name: 'Yesterday' });
    expect(yesterday).toHaveTextContent('Sent to expert');
    expect(yesterday).toHaveTextContent('Coder');
    expect(screen.getByRole('list', { name: 'Earlier' })).toHaveTextContent('12 windows');
    expect(
      screen.getByText('Kept 7 days. Deleting removes this record, not what was already sent.'),
    ).toBeInTheDocument();
  });

  it('says how many days it keeps, as set', async () => {
    const bridge = createFakeHostBridge({ sightLog: [TODAY_READ] });
    render(
      <HostBridgeProvider bridge={bridge}>
        <SightLogView name="Scout" days={3} />
      </HostBridgeProvider>,
    );
    expect(await screen.findByText(/^Kept 3 days\./)).toBeInTheDocument();
  });

  it('deletes one row', async () => {
    const bridge = createFakeHostBridge({ sightLog: [TODAY_READ, TODAY_SENT] });
    renderLog(bridge);
    const today = await screen.findByRole('list', { name: 'Today' });
    fireEvent.click(within(today).getAllByRole('button', { name: /Delete this record/ })[0]!);
    await waitFor(() => expect(within(today).getAllByRole('listitem')).toHaveLength(1));
    expect(bridge.sightLog.map((e) => e.id)).toEqual(['r2']);
  });

  it('asks before deleting everything, and keeps it all on Keep', async () => {
    const bridge = createFakeHostBridge({ sightLog: [TODAY_READ, YESTERDAY] });
    renderLog(bridge);
    await screen.findByRole('list', { name: 'Today' });

    fireEvent.click(screen.getByRole('button', { name: 'Delete all' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep them' }));
    expect(bridge.sightLog).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Delete all' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete all for good' }));
    expect(await screen.findByText("Scout hasn't looked at anything yet.")).toBeInTheDocument();
    expect(bridge.sightLog).toEqual([]);
  });

  it('has an empty state', async () => {
    renderLog(createFakeHostBridge({ sightLog: [] }));
    expect(await screen.findByText("Scout hasn't looked at anything yet.")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete all' })).toBeNull();
  });

  it('says so when the log cannot be read', async () => {
    const bridge = createFakeHostBridge({ sightLog: [] });
    bridge.listSightLog = () => Promise.reject(new Error('engine down'));
    renderLog(bridge);
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not read/);
  });
});

describe('SightLogView, the less common paths', () => {
  it('shows pointing as a read of element names, by app and window', async () => {
    const pointed: SightLogEntry = {
      id: 'p1',
      kind: 'read_element_names',
      at: iso(now),
      app: 'EXCEL.EXE',
      title: 'Budget.xlsx',
    };
    renderLog(createFakeHostBridge({ sightLog: [pointed] }));
    const row = within(await screen.findByRole('list', { name: 'Today' })).getByRole('listitem');
    expect(row).toHaveTextContent('Read element names');
    expect(row).toHaveTextContent('EXCEL.EXE · Budget.xlsx');
  });

  it('names an unnamed look, a text read from pixels and an unnamed expert plainly', async () => {
    const bridge = createFakeHostBridge({
      sightLog: [
        { id: 'a', kind: 'screenshot', at: iso(now), images: 2 },
        { id: 'b', kind: 'listed_windows', at: iso(now - 1000), windows: 1 },
        { id: 'c', kind: 'read_text', at: iso(now - 2000), chars: 1, source: 'ocr' },
        { id: 'd', kind: 'sent_to_expert', at: iso(now - 3000) },
        { id: 'e', kind: 'sent_to_ai', at: iso(now - 4000), providerId: 'openrouter', model: 'm' },
      ],
    });
    // No providerLabel: the brain is named by its id.
    render(
      <HostBridgeProvider bridge={bridge}>
        <SightLogView name="Scout" days={1} />
      </HostBridgeProvider>,
    );
    const today = await screen.findByRole('list', { name: 'Today' });
    const rows = within(today).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('The screen');
    expect(rows[0]).toHaveTextContent('2 pictures');
    expect(rows[1]).toHaveTextContent('Every open window');
    expect(rows[1]).toHaveTextContent('1 window');
    expect(rows[2]).toHaveTextContent('1 character · read from pixels');
    expect(rows[3]).toHaveTextContent('An expert');
    expect(rows[4]).toHaveTextContent('openrouter');
    expect(screen.getByText(/^Kept 1 day\./)).toBeInTheDocument();
  });

  it('reads the log again after a turn ends, and not after other events', async () => {
    const bridge = createFakeHostBridge({ sightLog: [] });
    renderLog(bridge);
    await screen.findByText("Scout hasn't looked at anything yet.");
    bridge.sightLog = [TODAY_READ];
    bridge.emit({ type: 'turn.delta', turnId: 't1', text: 'a' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole('list', { name: 'Today' })).toBeNull();
    bridge.emit({
      type: 'turn.completed',
      turnId: 't1',
      text: 'done',
      stopReason: 'end',
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    expect(await screen.findByRole('list', { name: 'Today' })).toHaveTextContent('Read text');
  });

  it('keeps a row, and every row, when deleting fails', async () => {
    const bridge = createFakeHostBridge({ sightLog: [TODAY_READ] });
    bridge.deleteSightLog = () => Promise.reject(new Error('locked'));
    bridge.clearSightLog = () => Promise.reject(new Error('locked'));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderLog(bridge);
    const today = await screen.findByRole('list', { name: 'Today' });
    fireEvent.click(within(today).getByRole('button', { name: /Delete this record/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete all' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete all for good' }));
    await waitFor(() => expect(errors).toHaveBeenCalledTimes(2));
    expect(within(today).getAllByRole('listitem')).toHaveLength(1);
    errors.mockRestore();
  });

  it('says the record is not available on a host without it', () => {
    const bridge = createFakeHostBridge();
    delete bridge.listSightLog;
    renderLog(bridge);
    expect(screen.getByText('This record is not available here.')).toBeInTheDocument();
  });
});
