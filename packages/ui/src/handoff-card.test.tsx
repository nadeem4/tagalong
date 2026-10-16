/** Tests for the hand-off cards: proposal, two-step chains and steering a working expert. */

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

  it('has no Project row for an expert that works in its own folder, and sends with no folder', async () => {
    const bridge = createFakeHostBridge();
    renderBubble(bridge);
    act(() =>
      bridge.emit({
        type: 'handoff.proposed',
        proposalId: PROPOSAL,
        petId: 'scout',
        expertId: 'trip-planner',
        expertName: 'Trip planner',
        brief: BRIEF,
        projects: [],
        canEdit: true,
        ownFolder: true,
      }),
    );
    const own = screen.getByRole('region', { name: 'Hand to Trip planner' });
    expect(own).toHaveTextContent('Works in its own folder');
    expect(own).not.toHaveTextContent('Choose the project');
    expect(within(own).queryByRole('button', { name: 'Change project' })).toBeNull();
    expect(within(own).queryByLabelText('Search projects')).toBeNull();

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Send' })));
    expect(bridge.confirmedHandoffs).toEqual([{ proposalId: PROPOSAL, canEdit: true }]);
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

  it('says when the brief carries the end of the error window, and keeps it when edited', async () => {
    const bridge = createFakeHostBridge();
    renderBubble(bridge);
    const brief = {
      ask: 'Fix the error in npm test - 2 failed',
      context: { windowTitle: 'npm test - 2 failed', windowText: 'FAIL parser.test.ts' },
    };
    act(() =>
      bridge.emit({
        type: 'handoff.proposed',
        proposalId: PROPOSAL,
        petId: 'scout',
        expertId: 'claude-code',
        expertName: 'Claude Code',
        brief,
        projects: [AI_PET],
        canEdit: false,
      }),
    );
    expect(card()).toHaveTextContent('Includes the end of the error window');
    fireEvent.click(screen.getByRole('button', { name: 'Edit brief' }));
    fireEvent.change(screen.getByLabelText('Brief'), { target: { value: 'Fix the lexer.' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Send' })));
    expect(bridge.confirmedHandoffs[0]?.brief).toEqual({ ...brief, ask: 'Fix the lexer.' });
  });

  it('says nothing about window text for a brief without it', () => {
    const bridge = createFakeHostBridge();
    renderBubble(bridge);
    propose(bridge);
    expect(card()).not.toHaveTextContent('Includes the end');
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

describe('a two-step hand-off', () => {
  const STEP2 = 'a3bb189e-8bf9-4888-9912-ace4e6543002';

  function proposeChain(bridge: FakeHostBridge) {
    act(() =>
      bridge.emit({
        type: 'handoff.proposed',
        proposalId: PROPOSAL,
        petId: 'scout',
        expertId: 'coder',
        expertName: 'Coder',
        brief: { ask: 'Fix the date bug.' },
        projects: [AI_PET],
        canEdit: true,
        then: {
          expertId: 'reviewer',
          expertName: 'Reviewer',
          ask: 'Check what Coder changed.',
          canEdit: false,
        },
      }),
    );
  }

  const chainCard = () => screen.getByRole('region', { name: 'Hand to Coder, then Reviewer' });

  function finishStep1(bridge: FakeHostBridge) {
    act(() =>
      bridge.emit({
        type: 'handoff.finished',
        handoffId: 'handoff-1',
        expertId: 'coder',
        state: 'done',
        text: 'The month was off by one.',
        changedFiles: ['date.ts'],
        next: { handoffId: STEP2, expertId: 'reviewer', expertName: 'Reviewer' },
      }),
    );
  }

  it('lists both steps with one project and their own access, and sends them on one Send', async () => {
    const bridge = createFakeHostBridge();
    renderBubble(bridge);
    proposeChain(bridge);

    const step1 = within(chainCard()).getByRole('group', { name: 'Step 1: Coder' });
    const step2 = within(chainCard()).getByRole('group', { name: 'Step 2: Reviewer' });
    expect(step1).toHaveTextContent('Can change files');
    expect(step1).toHaveTextContent('Fix the date bug.');
    expect(step2).toHaveTextContent('Reads only');
    expect(step2).toHaveTextContent('Check what Coder changed.');
    expect(within(chainCard()).getAllByText('ai_pet')).toHaveLength(1);

    fireEvent.click(within(step2).getByRole('button', { name: 'Allow edits' }));
    expect(step2).toHaveTextContent('Can change files');
    fireEvent.click(within(step2).getByRole('button', { name: 'Edit brief' }));
    fireEvent.change(within(step2).getByLabelText('Brief'), {
      target: { value: 'Check it and run the tests.' },
    });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Send' })));
    expect(bridge.confirmedHandoffs).toEqual([
      {
        proposalId: PROPOSAL,
        folder: 'C:\\projects\\ai_pet',
        canEdit: true,
        then: { canEdit: true, ask: 'Check it and run the tests.' },
      },
    ]);
  });

  it('sends then: null when step 2 is removed', async () => {
    const bridge = createFakeHostBridge();
    renderBubble(bridge);
    proposeChain(bridge);
    fireEvent.click(screen.getByRole('button', { name: 'Remove step 2' }));
    expect(screen.queryByRole('group', { name: 'Step 2: Reviewer' })).toBeNull();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Send' })));
    expect(bridge.confirmedHandoffs[0]).toEqual({
      proposalId: PROPOSAL,
      folder: 'C:\\projects\\ai_pet',
      canEdit: true,
      then: null,
    });
    expect(screen.getByRole('region', { name: 'Coder is on it' })).toBeVisible();
  });

  it('follows the chain: 1 of 2, then 2 of 2, then both answers, spoken once', async () => {
    const bridge = createFakeHostBridge();
    const onSay = vi.fn();
    render(
      <HostBridgeProvider bridge={bridge}>
        <CompanionBubble petId="scout" petName="Scout" onSay={onSay} />
      </HostBridgeProvider>,
    );
    proposeChain(bridge);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Send' })));
    expect(screen.getByRole('region', { name: 'Coder is on it (1 of 2)' })).toBeVisible();

    finishStep1(bridge);
    expect(onSay).not.toHaveBeenCalled();
    const checking = screen.getByRole('region', { name: 'Reviewer is checking (2 of 2)' });
    act(() =>
      bridge.emit({
        type: 'handoff.progress',
        handoffId: STEP2,
        expertId: 'reviewer',
        step: 'Reading date.ts',
      }),
    );
    expect(checking).toHaveTextContent('Reading date.ts');
    await act(async () => fireEvent.click(within(checking).getByRole('button', { name: 'Stop' })));
    expect(bridge.cancelledHandoffs).toEqual([STEP2]);

    act(() =>
      bridge.emit({
        type: 'handoff.finished',
        handoffId: STEP2,
        expertId: 'reviewer',
        state: 'done',
        text: 'The fix is right.',
      }),
    );
    const done = screen.getByRole('region', { name: 'Reviewer finished' });
    expect(done).toHaveTextContent('Coder changed date.ts');
    expect(done).toHaveTextContent('The month was off by one.');
    expect(done).toHaveTextContent('Reviewer says');
    expect(done).toHaveTextContent('The fix is right.');
    expect(onSay).toHaveBeenCalledExactlyOnceWith(
      'Coder and Reviewer have finished. The fix is right.',
    );
  });

  it('shows step 2 as stopped, with step 1’s answer kept, when Stop ends step 2', async () => {
    const bridge = createFakeHostBridge();
    const onSay = vi.fn();
    render(
      <HostBridgeProvider bridge={bridge}>
        <CompanionBubble petId="scout" petName="Scout" onSay={onSay} />
      </HostBridgeProvider>,
    );
    proposeChain(bridge);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Send' })));
    finishStep1(bridge);
    act(() =>
      bridge.emit({
        type: 'handoff.finished',
        handoffId: STEP2,
        expertId: 'reviewer',
        state: 'stopped',
      }),
    );
    const stopped = screen.getByRole('region', { name: 'Reviewer was stopped' });
    expect(stopped).toHaveTextContent('Coder changed date.ts');
    expect(stopped).toHaveTextContent('The month was off by one.');
    expect(stopped).not.toHaveTextContent('Reviewer says');
    expect(onSay).toHaveBeenCalledExactlyOnceWith('Reviewer stopped without finishing.');
  });

  it('ignores step 1’s late Send id after step 2 has already finished', async () => {
    const bridge = createFakeHostBridge();
    let answer: (value: { handoffId: string }) => void = () => undefined;
    bridge.confirmHandoff = () => new Promise((resolve) => (answer = resolve));
    renderBubble(bridge);
    proposeChain(bridge);
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    finishStep1(bridge);
    act(() =>
      bridge.emit({
        type: 'handoff.finished',
        handoffId: STEP2,
        expertId: 'reviewer',
        state: 'done',
        text: 'The fix is right.',
      }),
    );
    await act(async () => answer({ handoffId: 'handoff-1' }));
    expect(screen.getByRole('region', { name: 'Reviewer finished' })).toHaveTextContent(
      'The fix is right.',
    );
  });

  it('says step 2 never ran when step 1 failed', async () => {
    const bridge = createFakeHostBridge();
    renderBubble(bridge);
    proposeChain(bridge);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Send' })));
    act(() =>
      bridge.emit({
        type: 'handoff.finished',
        handoffId: 'handoff-1',
        expertId: 'coder',
        state: 'error',
        error: 'Coder is not signed in.',
      }),
    );
    const failed = screen.getByRole('region', { name: 'Coder could not finish' });
    expect(failed).toHaveTextContent('Reviewer did not start.');
  });

  it('keeps step 2 when step 1 finished before Send heard back', async () => {
    const bridge = createFakeHostBridge();
    let answer: (value: { handoffId: string }) => void = () => undefined;
    bridge.confirmHandoff = () => new Promise((resolve) => (answer = resolve));
    renderBubble(bridge);
    proposeChain(bridge);
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    finishStep1(bridge);
    await act(async () => answer({ handoffId: 'handoff-1' }));
    expect(screen.getByRole('region', { name: 'Reviewer is checking (2 of 2)' })).toBeVisible();
  });
});

describe('steering a working expert', () => {
  const step = (text: string, kind?: 'tool' | 'say' | 'note' | 'delivered' | 'dropped') =>
    act(() =>
      bridge.emit({
        type: 'handoff.progress',
        handoffId: 'handoff-1',
        expertId: 'claude-code',
        step: text,
        ...(kind === undefined ? {} : { kind }),
      }),
    );
  let bridge: FakeHostBridge;

  async function working(onSay?: (text: string) => void) {
    bridge = createFakeHostBridge();
    render(
      <HostBridgeProvider bridge={bridge}>
        <CompanionBubble
          petId="scout"
          petName="Scout"
          {...(onSay === undefined ? {} : { onSay })}
        />
      </HostBridgeProvider>,
    );
    propose(bridge);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Send' })));
    return screen.getByRole('region', { name: 'Claude Code is on it' });
  }

  it('shows a note as waiting, then delivered', async () => {
    const card = await working();
    step('use dayjs, not moment', 'note');
    expect(card).toHaveTextContent('Passed on: use dayjs, not moment');
    expect(card).toHaveTextContent('waiting for Claude Code to finish this step');
    step('use dayjs, not moment', 'delivered');
    expect(card).toHaveTextContent('Passed on: use dayjs, not moment');
    expect(card).toHaveTextContent('delivered');
    expect(card).not.toHaveTextContent('waiting for');
    // A note is not a step of the expert's own.
    expect(within(card).queryByRole('listitem')).toBeNull();
  });

  it('says when a note could not be passed on, and keeps saying it on the answer', async () => {
    const onSay = vi.fn();
    const card = await working(onSay);
    step('one more thing', 'note');
    step('one more thing', 'dropped');
    expect(card).toHaveTextContent('not passed on: Claude Code finished first');
    act(() =>
      bridge.emit({
        type: 'handoff.finished',
        handoffId: 'handoff-1',
        expertId: 'claude-code',
        state: 'done',
        text: 'Done.',
      }),
    );
    const done = screen.getByRole('region', { name: 'Claude Code finished' });
    expect(done).toHaveTextContent('Not passed on: one more thing');
    expect(onSay).toHaveBeenCalledExactlyOnceWith(
      'Claude Code has finished. Done. Claude Code finished before I could pass on your note.',
    );
  });

  it('speaks what the expert says at most once every 20 seconds; tool steps stay silent', async () => {
    vi.useFakeTimers();
    try {
      const onSay = vi.fn();
      const card = await working(onSay);
      step('Reading src/date.ts', 'tool');
      step('Found the bug in date.ts.', 'say');
      step('Fixing it now.', 'say');
      expect(card).toHaveTextContent('Found the bug in date.ts.');
      expect(card).toHaveTextContent('Fixing it now.');
      expect(onSay.mock.calls).toEqual([['Found the bug in date.ts.']]);
      act(() => vi.advanceTimersByTime(20_000));
      step('Tests still failing in two places.', 'say');
      expect(onSay.mock.calls).toEqual([
        ['Found the bug in date.ts.'],
        ['Tests still failing in two places.'],
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});
