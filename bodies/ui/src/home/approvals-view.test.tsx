/**
 * Tests for the Approvals page: the preference cards (remove, edit), the summary strip, the
 * filtered history grouped by day, its outcome chips and Scout-decided rows, and the refetch and
 * failure behaviour shared with the other Home panels.
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HostBridgeProvider, type ApprovalRow, type PreferenceRow } from '../host-bridge';
import { createFakeHostBridge, type FakeHostBridge } from '../test-support/fake-host-bridge';
import { ApprovalsView } from './approvals-view';

const DEFAULT_PREF: PreferenceRow = {
  id: 1,
  sentence: 'Always ask me before risky actions',
  builtin: true,
  createdAt: '2026-10-20T08:00:00.000Z',
  useCount: 0,
  lastUsed: null,
};
const GIT_PREF: PreferenceRow = {
  id: 2,
  sentence: 'Git commands in my repos are fine.',
  builtin: false,
  createdAt: '2026-10-24T08:00:00.000Z',
  useCount: 14,
  lastUsed: '2026-10-28T10:42:00.000Z',
};

/** A local-time moment `daysAgo` days back at noon, as the ISO string the brain sends. */
function at(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
}

const BY_PERSON: ApprovalRow = {
  id: 5,
  source: 'claude_code',
  tool: 'Bash',
  summary: 'Run pnpm install',
  outcome: 'approved',
  decidedBy: 'person',
  preference: null,
  at: at(0),
};
const BY_SCOUT: ApprovalRow = {
  ...BY_PERSON,
  id: 4,
  summary: 'Run git status',
  decidedBy: 'scout',
  preference: GIT_PREF.sentence,
};
const REFUSED: ApprovalRow = {
  ...BY_PERSON,
  id: 3,
  source: 'app',
  summary: 'Send draft to landlord',
  outcome: 'refused',
  at: at(1),
};
const TIMED_OUT: ApprovalRow = {
  ...BY_PERSON,
  id: 2,
  source: 'scout_tool',
  summary: 'Open the repo in your browser',
  outcome: 'timed_out',
  decidedBy: 'none',
  at: at(1),
};

function renderPage(bridge: FakeHostBridge) {
  render(
    <HostBridgeProvider bridge={bridge}>
      <ApprovalsView />
    </HostBridgeProvider>,
  );
}

const history = async () =>
  within(await screen.findByRole('region', { name: 'Approvals history' }));

afterEach(() => vi.restoreAllMocks());

describe('ApprovalsView preferences', () => {
  it('lists preferences with the default first and Remove on every card', async () => {
    renderPage(createFakeHostBridge({ preferences: [GIT_PREF, DEFAULT_PREF] }));
    const cards = within(await screen.findByRole('list', { name: 'Standing preferences' }))
      .getAllByRole('listitem')
      .map((card) => card.textContent ?? '');
    expect(cards).toHaveLength(2);
    expect(cards[0]).toContain('Always ask me before risky actions');
    expect(cards[1]).toContain('Git commands in my repos are fine.');
    expect(cards[1]).toContain('Used 14 times');
    expect(screen.getAllByRole('button', { name: /^Remove/ })).toHaveLength(2);
  });

  it('Remove calls removePreference then refetches', async () => {
    const bridge = createFakeHostBridge({ preferences: [DEFAULT_PREF, GIT_PREF] });
    renderPage(bridge);
    fireEvent.click(await screen.findByRole('button', { name: `Remove: ${GIT_PREF.sentence}` }));
    await waitFor(() => expect(bridge.preferenceRemovals).toEqual([2]));
    await waitFor(() => expect(screen.queryByText(GIT_PREF.sentence)).toBeNull());
    expect(screen.getByText(DEFAULT_PREF.sentence)).toBeVisible();
  });

  it('editing saves the new sentence and rejects an empty one in the form', async () => {
    const bridge = createFakeHostBridge({ preferences: [GIT_PREF] });
    renderPage(bridge);
    fireEvent.click(await screen.findByRole('button', { name: `Edit: ${GIT_PREF.sentence}` }));
    const box = screen.getByRole('textbox', { name: 'Preference sentence' });
    expect(box).toHaveValue(GIT_PREF.sentence);

    fireEvent.change(box, { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/write a sentence/i);
    expect(bridge.preferenceEdits).toEqual([]);

    fireEvent.change(box, { target: { value: 'Git status is fine.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(bridge.preferenceEdits).toEqual([{ id: 2, sentence: 'Git status is fine.' }]),
    );
    expect(await screen.findByText('Git status is fine.')).toBeVisible();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('Cancel leaves the sentence alone', async () => {
    const bridge = createFakeHostBridge({ preferences: [GIT_PREF] });
    renderPage(bridge);
    fireEvent.click(await screen.findByRole('button', { name: `Edit: ${GIT_PREF.sentence}` }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(bridge.preferenceEdits).toEqual([]);
  });

  it('shows the brain refusing an edit and keeps the form open', async () => {
    const bridge = createFakeHostBridge({ preferences: [GIT_PREF] });
    bridge.editPreference = () => Promise.reject(new Error('That preference is gone.'));
    renderPage(bridge);
    fireEvent.click(await screen.findByRole('button', { name: `Edit: ${GIT_PREF.sentence}` }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That preference is gone.');
    expect(screen.getByRole('textbox')).toBeVisible();
  });

  it("drops Electron's remote-method prefix from a refused edit", async () => {
    const bridge = createFakeHostBridge({ preferences: [GIT_PREF] });
    bridge.editPreference = () =>
      Promise.reject(
        new Error(
          "Error invoking remote method 'tagalong:approvals:preferences:edit': RpcError: That preference is gone.",
        ),
      );
    renderPage(bridge);
    fireEvent.click(await screen.findByRole('button', { name: `Edit: ${GIT_PREF.sentence}` }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('That preference is gone.');
    expect(alert).not.toHaveTextContent('Error invoking remote method');
  });

  it('Cancel clears the error a refused edit left up', async () => {
    const bridge = createFakeHostBridge({ preferences: [GIT_PREF] });
    bridge.editPreference = () => Promise.reject(new Error('That preference is gone.'));
    renderPage(bridge);
    fireEvent.click(await screen.findByRole('button', { name: `Edit: ${GIT_PREF.sentence}` }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('ApprovalsView history', () => {
  it('summary strip shows the counts from the brain', async () => {
    renderPage(createFakeHostBridge({ approvalRows: [BY_PERSON, BY_SCOUT, REFUSED] }));
    const strip = within(await screen.findByRole('group', { name: 'Summary' }));
    await waitFor(() => expect(strip.getByText('asks').previousSibling).toHaveTextContent('3'));
    expect(strip.getByText('Scout answered').previousSibling).toHaveTextContent('1');
    expect(strip.getByText('refused').previousSibling).toHaveTextContent('1');
  });

  it('filter buttons call listApprovals with the filter and mark aria-pressed', async () => {
    const bridge = createFakeHostBridge({ approvalRows: [BY_PERSON, BY_SCOUT, REFUSED] });
    renderPage(bridge);
    const all = await screen.findByRole('button', { name: /^All/ });
    expect(all).toHaveAttribute('aria-pressed', 'true');
    expect(all).toHaveTextContent('3');

    const scout = screen.getByRole('button', { name: /^Decided by Scout/ });
    expect(scout).toHaveTextContent('1');
    fireEvent.click(scout);
    await waitFor(() => expect(scout).toHaveAttribute('aria-pressed', 'true'));
    expect(all).toHaveAttribute('aria-pressed', 'false');
    expect(bridge.approvalListCalls.at(-1)).toEqual({ filter: 'scout' });
    expect((await history()).getAllByRole('listitem')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: /^Refused/ }));
    await waitFor(() => expect(bridge.approvalListCalls.at(-1)).toEqual({ filter: 'refused' }));
  });

  it('a scout row shows the sentence it relied on', async () => {
    renderPage(createFakeHostBridge({ approvalRows: [BY_SCOUT], preferences: [GIT_PREF] }));
    const row = (await history()).getByRole('listitem');
    expect(within(row).getByText('Run git status')).toBeVisible();
    expect(within(row).getByText(/Scout decided, per your preference/)).toBeVisible();
    expect(within(row).getByText(`“${GIT_PREF.sentence}”`)).toBeVisible();
    expect(within(row).getByText('Auto')).toBeVisible();
    expect(within(row).getByText('Approved')).toBeVisible();
  });

  it('a person row says who decided and has no Auto pill', async () => {
    renderPage(createFakeHostBridge({ approvalRows: [BY_PERSON] }));
    const row = (await history()).getByRole('listitem');
    expect(within(row).getByText(/Decided by/)).toBeVisible();
    expect(within(row).queryByText('Auto')).toBeNull();
  });

  it('a refused row and a timed out row get their chips', async () => {
    renderPage(createFakeHostBridge({ approvalRows: [REFUSED, TIMED_OUT] }));
    const [refused, timedOut] = (await history()).getAllByRole('listitem');
    expect(within(refused as HTMLElement).getByText('Refused')).toBeVisible();
    expect(within(refused as HTMLElement).getByText('Connected app')).toBeVisible();
    expect(within(timedOut as HTMLElement).getByText('Timed out')).toBeVisible();
    expect(within(timedOut as HTMLElement).getByText('Scout tool')).toBeVisible();
  });

  it('a row nobody answered says no one was online', async () => {
    renderPage(createFakeHostBridge({ approvalRows: [{ ...TIMED_OUT, outcome: 'no_one' }] }));
    expect((await history()).getByText('No one online')).toBeVisible();
  });

  it('rows group under Today and Yesterday', async () => {
    renderPage(createFakeHostBridge({ approvalRows: [BY_PERSON, REFUSED, TIMED_OUT] }));
    await history();
    const today = screen.getByRole('heading', { name: 'Today' });
    const yesterday = screen.getByRole('heading', { name: 'Yesterday' });
    expect(today.nextElementSibling).toHaveTextContent('Run pnpm install');
    expect(yesterday.nextElementSibling).toHaveTextContent('Send draft to landlord');
    expect(yesterday.nextElementSibling).toHaveTextContent('Open the repo in your browser');
  });

  it('older days are headed by their date', async () => {
    renderPage(createFakeHostBridge({ approvalRows: [{ ...BY_PERSON, at: at(5) }] }));
    await history();
    const label = new Date(at(5)).toLocaleDateString([], {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
    expect(screen.getByRole('heading', { name: label })).toBeVisible();
  });

  it('empty history says nothing here yet', async () => {
    renderPage(createFakeHostBridge());
    expect(await screen.findByText('Nothing here yet.')).toBeVisible();
  });

  it('Show more reads the next page and adds it to the list', async () => {
    const bridge = createFakeHostBridge();
    const counts = { total: 2, scout: 0, refused: 0 };
    const calls: (number | undefined)[] = [];
    bridge.listApprovals = (_filter, before) => {
      calls.push(before);
      return Promise.resolve(
        before === undefined
          ? { approvals: [BY_PERSON], counts, next: 5 }
          : { approvals: [REFUSED], counts, next: null },
      );
    };
    renderPage(bridge);
    fireEvent.click(await screen.findByRole('button', { name: 'Show more' }));
    expect(await screen.findByText('Send draft to landlord')).toBeVisible();
    expect(screen.getByText('Run pnpm install')).toBeVisible();
    expect(calls).toEqual([undefined, 5]);
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });

  it('a double click on Show more reads one page, not two', async () => {
    const bridge = createFakeHostBridge();
    const counts = { total: 2, scout: 0, refused: 1 };
    const calls: (number | undefined)[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    bridge.listApprovals = async (_filter, before) => {
      calls.push(before);
      if (before === undefined) return { approvals: [BY_PERSON], counts, next: 5 };
      await gate;
      return { approvals: [REFUSED], counts, next: null };
    };
    renderPage(bridge);
    const more = await screen.findByRole('button', { name: 'Show more' });
    fireEvent.click(more);
    fireEvent.click(more);
    release();
    expect(await screen.findByText('Send draft to landlord')).toBeVisible();
    expect(calls).toEqual([undefined, 5]);
    expect(screen.getAllByText('Send draft to landlord')).toHaveLength(1);
  });

  it('a Show more answer from the old filter does not mix into the new list', async () => {
    const bridge = createFakeHostBridge();
    const counts = { total: 2, scout: 1, refused: 1 };
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    bridge.listApprovals = async (filter, before) => {
      if (filter === 'refused') return { approvals: [REFUSED], counts, next: null };
      if (before === undefined) return { approvals: [BY_PERSON], counts, next: 5 };
      await gate;
      return { approvals: [TIMED_OUT], counts, next: null };
    };
    renderPage(bridge);
    fireEvent.click(await screen.findByRole('button', { name: 'Show more' }));
    fireEvent.click(screen.getByRole('button', { name: /^Refused/ }));
    expect(await screen.findByText('Send draft to landlord')).toBeVisible();
    release();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.queryByText('Open the repo in your browser')).toBeNull();
  });
});

describe('ApprovalsView brain link', () => {
  it('a changed approvals notice refetches', async () => {
    const bridge = createFakeHostBridge();
    renderPage(bridge);
    expect(await screen.findByText('Nothing here yet.')).toBeVisible();
    bridge.approvalRows = [BY_PERSON];
    act(() => bridge.emitChanged('approvals'));
    expect(await screen.findByText('Run pnpm install')).toBeVisible();
  });

  it('a failed read shows an alert and keeps the page', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const bridge = createFakeHostBridge();
    bridge.listApprovals = () => Promise.reject(new Error('brain offline'));
    renderPage(bridge);
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not read/i);
    expect(screen.getByRole('heading', { name: 'Approvals' })).toBeVisible();
  });

  it('a failed preferences read shows the alert but not the empty line', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const bridge = createFakeHostBridge({ preferences: [DEFAULT_PREF] });
    bridge.listPreferences = () => Promise.reject(new Error('brain offline'));
    renderPage(bridge);
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not read/i);
    expect(screen.queryByText(/None yet/)).toBeNull();
    expect(screen.queryByRole('group', { name: 'Summary' })).toBeNull();
  });

  it('the summary strip and empty lines are hidden until the first read lands', async () => {
    const bridge = createFakeHostBridge();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const read = bridge.listApprovals;
    bridge.listApprovals = async (filter, before) => {
      await gate;
      return read?.call(bridge, filter, before) as ReturnType<NonNullable<typeof read>>;
    };
    renderPage(bridge);
    expect(screen.queryByRole('group', { name: 'Summary' })).toBeNull();
    expect(screen.queryByText(/None yet/)).toBeNull();
    expect(screen.queryByText('Nothing here yet.')).toBeNull();
    release();
    expect(await screen.findByRole('group', { name: 'Summary' })).toBeVisible();
    expect(screen.getByText(/None yet/)).toBeVisible();
  });
});
