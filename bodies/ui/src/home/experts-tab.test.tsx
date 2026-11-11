/** Tests for the Experts tab: an open curated list, Show more, grouped installed experts, outcomes on the row. */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HostBridgeProvider } from '../host-bridge';
import type { SetupChoice, SetupExpert, SetupOverview, SetupResult } from '../shapes';
import { createFakeHostBridge } from '../test-support/fake-host-bridge';
import { ConnectionsPanel } from './connections-panel';

const choice = (id: string, name: string, over: Partial<SetupChoice> = {}): SetupChoice => ({
  id,
  name,
  version: '1',
  description: `${name} agent`,
  official: true,
  recommended: false,
  tested: true,
  ...over,
});
const CLAUDE = choice('claude-acp', 'Claude Code', { recommended: true });
const GEMINI = choice('gemini', 'Gemini CLI');
const CODEX = choice('codex-acp', 'Codex');
const GOOSE = choice('goose', 'Goose', { official: false, tested: false });
const SOMEONE = choice('someone-acp', 'Someone', { official: false });

const installed = (id: string, name: string, over: Partial<SetupExpert> = {}): SetupExpert => ({
  id,
  name,
  version: '2.0',
  state: 'ready',
  tested: true,
  official: true,
  ...over,
});

async function open(setup: Partial<SetupOverview>, setupResult?: SetupResult) {
  const bridge = createFakeHostBridge({ setup, ...(setupResult ? { setupResult } : {}) });
  render(
    <HostBridgeProvider bridge={bridge}>
      <ConnectionsPanel />
    </HostBridgeProvider>,
  );
  await screen.findByRole('heading', { name: 'Connections' });
  fireEvent.click(screen.getByRole('tab', { name: 'Experts' }));
  return bridge;
}

const click = async (element: HTMLElement) => {
  await act(async () => {
    fireEvent.click(element);
    await Promise.resolve();
  });
};

const rowOf = (name: string) => screen.getByText(name).closest('li') as HTMLElement;

describe('Experts tab: add an expert', () => {
  it('has the list open, with no Browse and add toggle', async () => {
    await open({ browseExperts: [CLAUDE] });
    expect(screen.queryByText('Browse and add')).toBeNull();
    expect(screen.getByRole('button', { name: 'Add Claude Code' })).toBeVisible();
    expect(
      screen.getByText('Experts take on long jobs for Scout, on your own login.'),
    ).toBeVisible();
    expect(screen.getByPlaceholderText('Codex, Goose, an agent for…')).toBeVisible();
  });

  it('Claude Code leads with Official, Recommended and Tested with Scout', async () => {
    await open({ browseExperts: [CLAUDE, GEMINI], showMoreFrom: 2 });
    const row = within(rowOf('Claude Code'));
    expect(row.getByText('Official')).toBeVisible();
    expect(row.getByText('Recommended')).toBeVisible();
    expect(row.getByText('Tested with Scout')).toBeVisible();
    expect(row.getByText('Runs on your PC · Signs in with your own account')).toBeVisible();
    expect(within(rowOf('Gemini CLI')).queryByText('Recommended')).toBeNull();
  });

  it('an untested community expert says it was not tested with Scout', async () => {
    await open({ browseExperts: [CLAUDE, GOOSE], showMoreFrom: 2 });
    const row = within(rowOf('Goose'));
    expect(row.getByText('Community')).toBeVisible();
    expect(row.getByText('Not tested with Scout')).toBeVisible();
    expect(within(rowOf('Claude Code')).queryByText('Not tested with Scout')).toBeNull();
  });

  it('Show more reveals the rest under its own label, and names them beside it', async () => {
    await open({ browseExperts: [CLAUDE, GEMINI, CODEX, GOOSE], showMoreFrom: 3 });
    expect(screen.queryByText('Goose')).toBeNull();
    expect(screen.getByText('Goose…')).toBeVisible();
    expect(
      screen.getByText('Only experts that install and run on this PC are listed.'),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    expect(screen.getByText('More experts that run on this PC')).toBeVisible();
    expect(within(rowOf('Goose')).getByText('Runs on your PC')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });

  it('shows every expert at once when the brain has no curated split', async () => {
    await open({ browseExperts: [CLAUDE, GOOSE], showMoreFrom: null });
    expect(screen.getByText('Goose')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });

  it('searching filters the list, including experts behind Show more', async () => {
    await open({ browseExperts: [CLAUDE, GEMINI, GOOSE], showMoreFrom: 2 });
    fireEvent.change(screen.getByLabelText('Search experts'), { target: { value: 'goo' } });
    expect(screen.getByText('Goose')).toBeVisible();
    expect(screen.queryByText('Claude Code')).toBeNull();
    fireEvent.change(screen.getByLabelText('Search experts'), { target: { value: 'zzz' } });
    expect(screen.getByText('No experts match "zzz".')).toBeVisible();
  });

  it('an official expert adds with the brain’s own Allow card', async () => {
    const bridge = await open({ browseExperts: [CODEX], showMoreFrom: 1 });
    await click(screen.getByRole('button', { name: 'Add Codex' }));
    expect(bridge.setupCalls).toEqual([{ kind: 'expert', id: 'codex-acp', approved: false }]);
  });

  it('a community expert opens the check card first; Add anyway sends community ok', async () => {
    const bridge = await open({ browseExperts: [SOMEONE], showMoreFrom: 1 });
    const add = screen.getByRole('button', { name: 'Add Someone' });
    expect(add).toHaveTextContent('Add…');
    await click(add);
    expect(screen.getByRole('group', { name: 'Check first' })).toBeVisible();
    expect(
      screen.getByText("The expert list doesn't say who made this or check it."),
    ).toBeVisible();
    expect(bridge.setupCalls).toEqual([]);
    await click(screen.getByRole('button', { name: 'Add anyway' }));
    expect(bridge.setupCalls).toEqual([
      { kind: 'expert', id: 'someone-acp', approved: true, communityOk: true },
    ]);
  });

  it('Back on the check card sends nothing', async () => {
    const bridge = await open({ browseExperts: [SOMEONE], showMoreFrom: 1 });
    await click(screen.getByRole('button', { name: 'Add Someone' }));
    await click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.queryByRole('group', { name: 'Check first' })).toBeNull();
    expect(bridge.setupCalls).toEqual([]);
  });

  it('a refusal shows on that row and keeps the button', async () => {
    await open({ browseExperts: [CODEX], showMoreFrom: 1 }, { error: 'denied' });
    await click(screen.getByRole('button', { name: 'Add Codex' }));
    expect(within(rowOf('Codex')).getByText('Okay, nothing was changed.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Add Codex' })).toBeVisible();
  });

  it('an install in progress shows its percent, a bar and what it is doing, instead of the button', async () => {
    await open({
      browseExperts: [CODEX],
      showMoreFrom: 1,
      progress: { expert: 'codex-acp', stage: 'node', percent: 40 },
    });
    const row = within(rowOf('Codex'));
    expect(row.getByText('Installing…')).toBeVisible();
    expect(row.getByText('40%')).toBeVisible();
    expect(row.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40');
    expect(row.getByText('Getting what it needs to run')).toBeVisible();
    expect(screen.queryByText(/Tagalong’s own Node/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add Codex' })).toBeNull();
  });

  it('a failed install shows on its row with Try again, not at the top of the page', async () => {
    const bridge = await open({
      browseExperts: [CODEX, GEMINI],
      showMoreFrom: 2,
      failed: { expert: 'codex-acp', error: 'integrity' },
    });
    const row = within(rowOf('Codex'));
    expect(row.getByText("Setting up Codex didn't finish.")).toBeVisible();
    expect(within(rowOf('Gemini CLI')).queryByText(/didn't finish/)).toBeNull();
    await click(row.getByRole('button', { name: 'Try again' }));
    expect(bridge.setupCalls).toEqual([{ kind: 'expert', id: 'codex-acp', approved: false }]);
  });

  it('opens Show more by itself when the failed expert is in the hidden part', async () => {
    await open({
      browseExperts: [CLAUDE, GOOSE],
      showMoreFrom: 1,
      failed: { expert: 'goose', error: 'integrity' },
    });
    expect(within(rowOf('Goose')).getByText("Setting up Goose didn't finish.")).toBeVisible();
  });
});

describe('Experts tab: your experts', () => {
  it('splits into Official and Community', async () => {
    await open({
      experts: [
        installed('claude-acp', 'Claude Code'),
        installed('x', 'Xtra', { official: false }),
      ],
    });
    const card = within(screen.getByRole('region', { name: 'Your experts' }));
    expect(card.getByText('Official', { selector: 'p' })).toBeVisible();
    expect(card.getByText('Community', { selector: 'p' })).toBeVisible();
    const official = within(screen.getByRole('list', { name: 'Official experts' }));
    expect(official.getByText('Claude Code')).toBeVisible();
    expect(official.queryByText('Xtra')).toBeNull();
  });

  it('a row is the name, then the version and the kind of job', async () => {
    await open({ experts: [installed('claude-acp', 'Claude Code')] });
    const row = within(screen.getByRole('region', { name: 'Claude Code' }));
    expect(row.getByText('v2.0 · Fix code and other long jobs')).toBeVisible();
    expect(row.getByText('Ready')).toBeVisible();
    expect(row.queryByRole('button')).toBeNull();
  });

  it('says Needs sign-in with a Sign in button, and Update available with Update', async () => {
    const bridge = await open({
      experts: [
        installed('claude-acp', 'Claude Code', { state: 'needs_login' }),
        installed('b', 'Beta', { state: 'needs_update' }),
      ],
    });
    const claude = within(screen.getByRole('region', { name: 'Claude Code' }));
    expect(claude.getByText('Needs sign-in')).toBeVisible();
    await click(claude.getByRole('button', { name: 'Sign in' }));
    expect(bridge.setupCalls).toEqual([{ kind: 'expert', id: 'claude-acp', approved: false }]);
    const beta = within(screen.getByRole('region', { name: 'Beta' }));
    expect(beta.getByText('Update available')).toBeVisible();
    expect(beta.getByRole('button', { name: 'Update' })).toBeVisible();
  });

  it('an untested expert reads Not tested with Scout', async () => {
    await open({
      experts: [
        installed('claude-acp', 'Claude Code'),
        installed('x', 'Xtra', { tested: false, official: false }),
      ],
    });
    expect(
      within(screen.getByRole('region', { name: 'Xtra' })).getByText('Not tested with Scout'),
    ).toBeVisible();
    expect(
      within(screen.getByRole('region', { name: 'Claude Code' })).queryByText(
        'Not tested with Scout',
      ),
    ).toBeNull();
  });

  it('a login that is waiting says where to finish it, on that row', async () => {
    await open(
      { experts: [installed('claude-acp', 'Claude Code', { state: 'needs_login' })] },
      { state: 'waiting' },
    );
    await click(screen.getByRole('button', { name: 'Sign in' }));
    expect(
      within(screen.getByRole('region', { name: 'Claude Code' })).getByText(
        /Finish logging in in the window that opened/,
      ),
    ).toBeVisible();
  });

  it('says there are none yet', async () => {
    await open({ experts: [] });
    expect(screen.getByText('No experts yet. Add one below.')).toBeVisible();
  });
});
