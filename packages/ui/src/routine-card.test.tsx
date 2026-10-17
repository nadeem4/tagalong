/** Tests for RoutineCard and the bubble's routine turns. */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { RoutineProposedParams } from '@tagalong/protocol';
import { CompanionBubble } from './companion-bubble';
import { HostBridgeProvider } from './host-bridge';
import { createFakeHostBridge, type FakeHostBridge } from './test-support/fake-host-bridge';

const PROPOSAL = '40000000-0000-4000-8000-000000000001';
const SAVED_ID = '40000000-0000-4000-8000-000000000002';

const proposed = (
  patch: Partial<RoutineProposedParams> = {},
): RoutineProposedParams & { type: 'routine.proposed' } => ({
  type: 'routine.proposed',
  proposalId: PROPOSAL,
  petId: 'scout',
  action: 'create',
  routine: {
    name: 'Morning papers',
    enabled: true,
    when: { type: 'schedule', days: [1, 2, 3, 4, 5], time: '08:00' },
    what: 'Find new papers on my topics and explain the best one simply.',
    topics: 'AI agents',
    deliver: { bubble: true, voice: true, notification: false },
    handTo: 'claude-code',
    uses: ['Claude Code'],
  },
  handToName: 'Claude Code',
  ...patch,
});

function renderBubble(bridge: FakeHostBridge) {
  render(
    <HostBridgeProvider bridge={bridge}>
      <CompanionBubble petId="scout" petName="Scout" />
    </HostBridgeProvider>,
  );
}

const flush = () => act(async () => await Promise.resolve());

describe('the routine card', () => {
  it('shows name, when, what, uses and where the result goes, with the hand-off said plainly', () => {
    const bridge = createFakeHostBridge();
    renderBubble(bridge);
    act(() => bridge.emit(proposed()));
    const card = screen.getByRole('region', { name: 'Set up Morning papers?' });
    expect(card).toHaveTextContent('Morning papers');
    expect(card).toHaveTextContent('Weekdays at 08:00');
    expect(card).toHaveTextContent('Find new papers on my topics');
    expect(card).toHaveTextContent('Topics: AI agents');
    expect(card).toHaveTextContent('May hand to: Claude Code, read-only, no project');
    expect(card).toHaveTextContent('Bubble, voice, Activity');
    expect(card).toHaveTextContent('Nothing runs until you save it.');
    expect(card).not.toHaveTextContent(/I’d|Here’s/);
  });

  it.each([
    ['update', 'Nothing changes until you save it.'],
    ['pause', 'It stays paused until you turn it back on.'],
    ['resume', 'It runs again on its schedule.'],
    ['delete', 'This can’t be undone.'],
  ] as const)('leads the %s card with what happens, not with Scout speaking', (action, lead) => {
    const bridge = createFakeHostBridge();
    renderBubble(bridge);
    act(() => bridge.emit(proposed({ action, routineId: SAVED_ID })));
    expect(screen.getByText(lead)).toBeInTheDocument();
  });

  it('saves nothing until Save, then offers to run it now to test', async () => {
    const bridge = createFakeHostBridge();
    renderBubble(bridge);
    act(() => bridge.emit(proposed()));
    expect(bridge.confirmedRoutines).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await flush();
    expect(bridge.confirmedRoutines).toEqual([{ proposalId: PROPOSAL }]);
    expect(screen.getByText(/Saved\. Run it now to test\?/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Run it now' }));
    await flush();
    expect(bridge.ranRoutines).toHaveLength(1);
    expect(screen.queryByRole('region', { name: /Morning papers/ })).not.toBeInTheDocument();
  });

  it('Cancel dismisses it, and Edit opens it in Home', async () => {
    const bridge = createFakeHostBridge();
    renderBubble(bridge);
    act(() => bridge.emit(proposed()));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await flush();
    expect(bridge.editedRoutines.map((p) => p.proposalId)).toEqual([PROPOSAL]);
    act(() => bridge.emit(proposed()));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await flush();
    expect(bridge.dismissedRoutines).toEqual([PROPOSAL]);
    expect(bridge.confirmedRoutines).toEqual([]);
  });

  it('names the change for pause and delete, and confirms with the action', async () => {
    const bridge = createFakeHostBridge();
    renderBubble(bridge);
    act(() => bridge.emit(proposed({ action: 'delete', routineId: SAVED_ID })));
    expect(screen.getByRole('region', { name: 'Delete Morning papers?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await flush();
    expect(bridge.confirmedRoutines).toEqual([{ proposalId: PROPOSAL }]);
    expect(screen.queryByText(/Run it now/)).not.toBeInTheDocument();

    act(() => bridge.emit(proposed({ action: 'pause', routineId: SAVED_ID })));
    expect(screen.getByRole('region', { name: 'Pause Morning papers?' })).toBeInTheDocument();
  });
});

describe('the bubble and routine turns', () => {
  it('never takes a routine’s turn for the person’s own question', () => {
    const bridge = createFakeHostBridge();
    renderBubble(bridge);
    fireEvent.change(screen.getByLabelText('Ask Scout'), { target: { value: 'hello' } });
    fireEvent.keyDown(screen.getByLabelText('Ask Scout'), { key: 'Enter' });
    act(() =>
      bridge.emit({
        type: 'turn.started',
        turnId: '40000000-0000-4000-8000-0000000000aa',
        petId: 'scout',
        conversationId: '40000000-0000-4000-8000-0000000000bb',
        routineId: SAVED_ID,
      }),
    );
    act(() =>
      bridge.emit({
        type: 'turn.delta',
        turnId: '40000000-0000-4000-8000-0000000000aa',
        text: 'Routine words',
      }),
    );
    expect(screen.queryByText('Routine words')).not.toBeInTheDocument();
  });

  it('opens on a routine’s result and continues its conversation', async () => {
    const bridge = createFakeHostBridge();
    const conversationId = '40000000-0000-4000-8000-0000000000cc';
    render(
      <HostBridgeProvider bridge={bridge}>
        <CompanionBubble
          petId="scout"
          petName="Scout"
          resume={{ conversationId, question: 'Morning papers', answer: 'Two new papers.' }}
        />
      </HostBridgeProvider>,
    );
    expect(screen.getByText('Two new papers.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Ask Scout'), {
      target: { value: 'explain the second paper' },
    });
    fireEvent.keyDown(screen.getByLabelText('Ask Scout'), { key: 'Enter' });
    await flush();
    expect(bridge.asks[0]).toMatchObject({ conversationId, text: 'explain the second paper' });
  });
});
