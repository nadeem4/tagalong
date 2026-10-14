import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ProjectCandidate } from '@tagalong/protocol';
import { CompanionBubble } from './companion-bubble';
import { HostBridgeProvider } from './host-bridge';
import { createFakeHostBridge, type FakeHostBridge } from './test-support/fake-host-bridge';

const PROPOSAL = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const AI_PET: ProjectCandidate = { name: 'ai_pet', path: 'C:\\projects\\ai_pet', reason: 'screen' };
const SITE: ProjectCandidate = { name: 'site', path: 'C:\\projects\\site', reason: 'remembered' };
const BRIEF = { ask: 'Find why the shutdown test fails.' };

function renderBubble(bridge: FakeHostBridge) {
  render(
    <HostBridgeProvider bridge={bridge}>
      <CompanionBubble petId="scout" petName="Scout" />
    </HostBridgeProvider>,
  );
}

function propose(
  bridge: FakeHostBridge,
  projects: ProjectCandidate[] = [AI_PET, SITE],
  petId = 'scout',
) {
  act(() =>
    bridge.emit({
      type: 'handoff.proposed',
      proposalId: PROPOSAL,
      petId,
      expertId: 'claude-code',
      expertName: 'Claude Code',
      brief: BRIEF,
      projects,
      canEdit: false,
    }),
  );
}

const card = () => screen.getByRole('region', { name: 'Hand to Claude Code' });

describe('the hand-off card', () => {
  it('shows the agent, the guessed project, the access and the brief, and sends on Send', async () => {
    const bridge = createFakeHostBridge();
    renderBubble(bridge);
    propose(bridge);

    expect(card()).toHaveTextContent('Claude Code');
    expect(card()).toHaveTextContent('ai_pet');
    expect(card()).toHaveTextContent('C:\\projects\\ai_pet');
    expect(card()).toHaveTextContent('Reads only');
    expect(card()).toHaveTextContent('Find why the shutdown test fails.');

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Send' })));
    expect(bridge.confirmedHandoffs).toEqual([
      { proposalId: PROPOSAL, folder: 'C:\\projects\\ai_pet', canEdit: false },
    ]);
  });

  it('changes the project to another guess, a search result, or a picked folder', async () => {
    const bridge = createFakeHostBridge({
      searchProjects: () => [{ name: 'acme-api', path: 'D:\\acme-api', reason: 'found' }],
      pickFolder: () => 'E:\\elsewhere',
    });
    renderBubble(bridge);
    propose(bridge);

    fireEvent.click(screen.getByRole('button', { name: 'Change project' }));
    fireEvent.click(screen.getByRole('button', { name: /site/ }));
    expect(card()).toHaveTextContent('C:\\projects\\site');

    fireEvent.click(screen.getByRole('button', { name: 'Change project' }));
    fireEvent.change(screen.getByLabelText('Search projects'), { target: { value: 'acme' } });
    fireEvent.click(await screen.findByRole('button', { name: /acme-api/ }));
    expect(card()).toHaveTextContent('D:\\acme-api');

    fireEvent.click(screen.getByRole('button', { name: 'Change project' }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Browse…' })));
    expect(card()).toHaveTextContent('E:\\elsewhere');
  });

  it('asks for a project when it could not guess one, and waits for it before sending', async () => {
    const bridge = createFakeHostBridge({ pickFolder: () => 'C:\\x' });
    renderBubble(bridge);
    propose(bridge, []);
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(screen.getByLabelText('Search projects')).toBeVisible();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Browse…' })));
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
  });

  it('lets this one task edit files, and sends the brief as edited', async () => {
    const bridge = createFakeHostBridge();
    renderBubble(bridge);
    propose(bridge);
    fireEvent.click(screen.getByRole('button', { name: 'Allow edits' }));
    expect(card()).toHaveTextContent('Can change files');
    fireEvent.click(screen.getByRole('button', { name: 'Edit brief' }));
    fireEvent.change(screen.getByLabelText('Brief'), { target: { value: 'Fix the test.' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Send' })));
    expect(bridge.confirmedHandoffs[0]).toEqual({
      proposalId: PROPOSAL,
      folder: 'C:\\projects\\ai_pet',
      canEdit: true,
      brief: { ask: 'Fix the test.' },
    });
  });

  it('drops the proposal on Cancel', async () => {
    const bridge = createFakeHostBridge();
    renderBubble(bridge);
    propose(bridge);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Cancel' })));
    expect(bridge.dismissedHandoffs).toEqual([PROPOSAL]);
    expect(screen.queryByRole('region', { name: 'Hand to Claude Code' })).toBeNull();
  });

  it('ignores a proposal from another pet', () => {
    const bridge = createFakeHostBridge();
    renderBubble(bridge);
    propose(bridge, [AI_PET], 'ink');
    expect(screen.queryByRole('region', { name: 'Hand to Claude Code' })).toBeNull();
  });

  it('shows the expert’s steps while it works, with Stop, then its answer', async () => {
    const bridge = createFakeHostBridge();
    renderBubble(bridge);
    propose(bridge);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Send' })));

    const working = screen.getByRole('region', { name: 'Claude Code is on it' });
    expect(working).toHaveTextContent('ai_pet');
    act(() =>
      bridge.emit({
        type: 'handoff.progress',
        handoffId: 'handoff-1',
        expertId: 'claude-code',
        step: 'Reading src/engine.ts',
      }),
    );
    expect(working).toHaveTextContent('Reading src/engine.ts');
    await act(async () => fireEvent.click(within(working).getByRole('button', { name: 'Stop' })));
    expect(bridge.cancelledHandoffs).toEqual(['handoff-1']);

    act(() =>
      bridge.emit({
        type: 'handoff.finished',
        handoffId: 'handoff-1',
        expertId: 'claude-code',
        state: 'done',
        text: 'The engine closes the database before the turn ends.',
        changedFiles: ['src/engine.ts'],
      }),
    );
    const done = screen.getByRole('region', { name: 'Claude Code finished' });
    expect(done).toHaveTextContent('The engine closes the database before the turn ends.');
    expect(done).toHaveTextContent('src/engine.ts');
    fireEvent.click(within(done).getByRole('button', { name: 'Dismiss' }));
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Claude Code finished' })).toBeNull(),
    );
  });

  it('keeps the answer of an expert that finished before Send heard back', async () => {
    const bridge = createFakeHostBridge();
    let answer: (value: { handoffId: string }) => void = () => undefined;
    bridge.confirmHandoff = () => new Promise((resolve) => (answer = resolve));
    renderBubble(bridge);
    propose(bridge);
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    act(() =>
      bridge.emit({
        type: 'handoff.finished',
        handoffId: 'handoff-1',
        expertId: 'claude-code',
        state: 'done',
        text: 'Nothing to change.',
      }),
    );
    await act(async () => answer({ handoffId: 'handoff-1' }));

    expect(screen.getByRole('region', { name: 'Claude Code finished' })).toHaveTextContent(
      'Nothing to change.',
    );
    expect(screen.queryByRole('region', { name: 'Claude Code is on it' })).toBeNull();
  });

  it('says plainly when the expert could not finish', async () => {
    const bridge = createFakeHostBridge();
    renderBubble(bridge);
    propose(bridge);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Send' })));
    act(() =>
      bridge.emit({
        type: 'handoff.finished',
        handoffId: 'handoff-1',
        expertId: 'claude-code',
        state: 'error',
        error: 'Claude Code is not signed in.',
      }),
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Claude Code is not signed in.');
  });

  it('announces aloud that the expert finished, with its answer', async () => {
    const bridge = createFakeHostBridge();
    const onSay = vi.fn();
    render(
      <HostBridgeProvider bridge={bridge}>
        <CompanionBubble petId="scout" petName="Scout" onSay={onSay} />
      </HostBridgeProvider>,
    );
    propose(bridge);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Send' })));
    act(() =>
      bridge.emit({
        type: 'handoff.finished',
        handoffId: 'handoff-1',
        expertId: 'claude-code',
        state: 'done',
        text: 'The engine closes the database first.',
      }),
    );
    expect(onSay).toHaveBeenCalledExactlyOnceWith(
      'Claude Code has finished. The engine closes the database first.',
    );
  });
});
