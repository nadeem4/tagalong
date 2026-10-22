/**
 * Tests for LearnedView: the pages, the last night, editing a page, the newest change undone,
 * proposals accepted or rejected, a version's text opened, and errors shown.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { SelfVersion } from '@tagalong/protocol';
import { HostBridgeProvider } from '../host-bridge';
import { createFakeHostBridge, type FakeHostBridge } from '../test-support/fake-host-bridge';
import { LearnedView } from './learned-view';

const AT = '2026-10-19T03:00:00.000Z';

const BY_SLEEP: SelfVersion = {
  id: 7,
  path: 'lessons.md',
  author: 'sleep',
  why: 'They said Not now to repeat build alerts.',
  state: 'applied',
  acceptedBy: 'person',
  text: 'They do not want repeat build alerts.',
  chars: 38,
  at: AT,
};
const BY_SCOUT: SelfVersion = {
  id: 3,
  path: 'lessons.md',
  author: 'scout',
  why: 'They corrected me.',
  state: 'applied',
  text: 'Lead with the gist.',
  chars: 20,
  at: AT,
};
const PROPOSED: SelfVersion = {
  id: 9,
  path: 'lessons.md',
  author: 'sleep',
  why: 'Three answers trimmed.',
  state: 'proposed',
  text: 'Keep answers to two lines.',
  chars: 26,
  at: AT,
};

function renderLearned(bridge: FakeHostBridge) {
  render(
    <HostBridgeProvider bridge={bridge}>
      <LearnedView name="Scout" />
    </HostBridgeProvider>,
  );
}

describe('LearnedView', () => {
  it('says what sleep is before Scout has slept, and lists the three pages', async () => {
    renderLearned(createFakeHostBridge());
    expect(await screen.findByText(/has not slept yet/)).toBeInTheDocument();
    const pages = screen.getByRole('list', { name: 'Pages' });
    expect(
      within(pages)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['you.md', 'lessons.md', 'commitments.md']);
  });

  it('shows the last night and what it changed', async () => {
    renderLearned(
      createFakeHostBridge({
        nights: [{ state: 'done', startedAt: AT, note: 'Changed lessons.md.' }],
      }),
    );
    expect(await screen.findByText(/Changed lessons\.md\./)).toBeInTheDocument();
  });

  it('opens a page with its changes, who made each and why, newest first', async () => {
    renderLearned(
      createFakeHostBridge({
        selfPages: { 'lessons.md': 'They do not want repeat build alerts.' },
        selfVersions: [BY_SLEEP, BY_SCOUT],
      }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'lessons.md' }));
    const editor = await screen.findByRole('textbox', { name: 'lessons.md' });
    await waitFor(() => expect(editor).toHaveValue('They do not want repeat build alerts.'));
    const changes = screen.getByRole('list', { name: 'Changes' });
    const lines = within(changes)
      .getAllByRole('listitem')
      .map((item) => item.textContent ?? '');
    expect(lines[0]).toContain('Scout, while sleeping');
    expect(lines[0]).toContain('accepted by you');
    expect(lines[0]).toContain('They said Not now to repeat build alerts.');
    expect(lines[1]).toContain('Scout, in a conversation');
  });

  it('offers Undo only on the newest change; older ones are read-only', async () => {
    renderLearned(
      createFakeHostBridge({
        selfPages: { 'lessons.md': 'They do not want repeat build alerts.' },
        selfVersions: [BY_SLEEP, BY_SCOUT],
      }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'lessons.md' }));
    const changes = await screen.findByRole('list', { name: 'Changes' });
    const [newest, older] = within(changes).getAllByRole('listitem');
    expect(within(newest!).getByRole('button', { name: 'Undo' })).toBeInTheDocument();
    expect(within(older!).queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('opens a version to read its text', async () => {
    renderLearned(
      createFakeHostBridge({
        selfPages: { 'lessons.md': 'They do not want repeat build alerts.' },
        selfVersions: [BY_SLEEP, BY_SCOUT],
      }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'lessons.md' }));
    const changes = await screen.findByRole('list', { name: 'Changes' });
    const older = within(changes).getAllByRole('listitem')[1]!;
    expect(within(older).queryByText('Lead with the gist.')).toBeNull();
    fireEvent.click(within(older).getByRole('button', { name: 'Show text' }));
    expect(within(older).getByText('Lead with the gist.')).toBeInTheDocument();
  });

  it('shows a proposed change with its text, and counts it on the page', async () => {
    renderLearned(
      createFakeHostBridge({
        selfPages: { 'lessons.md': 'Lead with the gist.' },
        selfVersions: [PROPOSED, BY_SCOUT],
      }),
    );
    expect(await screen.findByText('1 to review')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'lessons.md' }));
    const changes = await screen.findByRole('list', { name: 'Changes' });
    const proposal = within(changes).getAllByRole('listitem')[0]!;
    expect(proposal.textContent).toContain('Proposed');
    expect(within(proposal).getByText('Keep answers to two lines.')).toBeInTheDocument();
    expect(within(proposal).queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('accepts a proposed change onto the page', async () => {
    const bridge = createFakeHostBridge({
      selfPages: { 'lessons.md': 'Lead with the gist.' },
      selfVersions: [PROPOSED],
    });
    renderLearned(bridge);
    fireEvent.click(await screen.findByRole('button', { name: 'lessons.md' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Accept' }));
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'lessons.md' })).toHaveValue(
        'Keep answers to two lines.',
      ),
    );
  });

  it('rejects a proposed change, keeping it on record as rejected', async () => {
    const bridge = createFakeHostBridge({
      selfPages: { 'lessons.md': 'Lead with the gist.' },
      selfVersions: [PROPOSED],
    });
    renderLearned(bridge);
    fireEvent.click(await screen.findByRole('button', { name: 'lessons.md' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Reject' }));
    expect(await screen.findByText(/· Rejected/)).toBeInTheDocument();
    expect(bridge.selfPages['lessons.md']).toBe('Lead with the gist.');
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull();
  });

  it('saves the person’s own edit, and says when it was cut to fit', async () => {
    const bridge = createFakeHostBridge();
    renderLearned(bridge);
    const editor = await screen.findByRole('textbox', { name: 'you.md' });
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    fireEvent.change(editor, { target: { value: 'Works on Tagalong.' } });
    fireEvent.click(save);
    await waitFor(() => expect(bridge.selfPages['you.md']).toBe('Works on Tagalong.'));
    fireEvent.change(editor, { target: { value: 'x'.repeat(6_001) } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/Saved the first 6000 characters/)).toBeInTheDocument();
  });

  it('says so when a save fails, instead of failing silently', async () => {
    renderLearned(createFakeHostBridge({ selfWriteFails: true }));
    const editor = await screen.findByRole('textbox', { name: 'you.md' });
    fireEvent.change(editor, { target: { value: 'Works on Tagalong.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Not saved: engine restarting')).toBeInTheDocument();
  });

  it('says the last sleep failed, and why', async () => {
    renderLearned(
      createFakeHostBridge({
        nights: [{ state: 'error', startedAt: AT, note: 'the night gave no JSON' }],
      }),
    );
    expect(
      await screen.findByText(/Last sleep failed: the night gave no JSON/),
    ).toBeInTheDocument();
  });

  it('undoes a change', async () => {
    const bridge = createFakeHostBridge({
      selfPages: { 'lessons.md': 'They do not want repeat build alerts.' },
      selfVersions: [BY_SLEEP],
    });
    renderLearned(bridge);
    fireEvent.click(await screen.findByRole('button', { name: 'lessons.md' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(bridge.selfPages['lessons.md']).toBe(''));
  });
});
