/** Tests for the confirm card: Allow once, Always allow and Deny, for apps and the brain's asks. */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CompanionBubble } from './companion-bubble';
import { HostBridgeProvider } from './host-bridge';
import { createFakeHostBridge, type FakeHostBridge } from './test-support/fake-host-bridge';

const APPROVAL = '20000000-0000-4000-8000-000000000001';
const TURN = '20000000-0000-4000-8000-000000000002';

const confirm = () =>
  ({
    type: 'connector.confirm',
    approvalId: APPROVAL,
    turnId: TURN,
    petId: 'scout',
    app: 'Notion',
    tool: 'create-pages',
    summary: 'Create a page.\ntitle: Launch plan',
  }) as const;

function renderBubble(bridge: FakeHostBridge, expanded = false) {
  render(
    <HostBridgeProvider bridge={bridge}>
      <CompanionBubble petId="scout" petName="Scout" expanded={expanded} />
    </HostBridgeProvider>,
  );
}

describe('the connector confirm card', () => {
  it('says which app, which tool and what will happen, and runs only on Allow once', async () => {
    const bridge = createFakeHostBridge();
    renderBubble(bridge);
    act(() => bridge.emit(confirm()));
    const card = screen.getByRole('region', { name: 'Change something in Notion?' });
    expect(card).toHaveTextContent('Notion');
    expect(card).toHaveTextContent('create-pages');
    expect(card).toHaveTextContent('title: Launch plan');
    // Neutral: the body never asks in Scout's voice.
    expect(card).toHaveTextContent('Change in Notion — allow?');
    expect(card).not.toHaveTextContent(/\bI[’']/);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Allow once' }));
      await Promise.resolve();
    });
    expect(bridge.approvals).toEqual([{ approvalId: APPROVAL, decision: 'once' }]);
    expect(screen.queryByRole('region', { name: 'Change something in Notion?' })).toBeNull();
  });

  it('Deny answers no', async () => {
    const bridge = createFakeHostBridge();
    renderBubble(bridge, true);
    act(() => bridge.emit(confirm()));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
      await Promise.resolve();
    });
    expect(bridge.approvals).toEqual([{ approvalId: APPROVAL, decision: 'deny' }]);
  });

  describe("an ask from the brain's tool gate", () => {
    const ask = (over: Record<string, unknown> = {}) =>
      ({
        ...confirm(),
        app: 'Desktop',
        tool: 'desktop__move_window',
        summary: "I'll move the Notes window to the left.",
        options: ['allow', 'always', 'deny'] as string[],
        ...over,
      }) as const;

    it('shows Scout’s words, never the connector wording', () => {
      const bridge = createFakeHostBridge();
      renderBubble(bridge);
      act(() => bridge.emit(ask()));
      const card = screen.getByRole('region', { name: 'Allow desktop__move_window?' });
      expect(card).toHaveTextContent("I'll move the Notes window to the left.");
      expect(card).not.toHaveTextContent('Change in');
    });

    it('with no words, shows the tool name and its input', () => {
      const bridge = createFakeHostBridge();
      renderBubble(bridge);
      act(() => bridge.emit(ask({ summary: 'desktop__move_window\nx: 1' })));
      const card = screen.getByRole('region', { name: 'Allow desktop__move_window?' });
      expect(card).toHaveTextContent('desktop__move_window');
      expect(card).toHaveTextContent('x: 1');
    });

    it.each([
      ['Allow once', 'once'],
      ['Always allow', 'always'],
      ['Deny', 'deny'],
    ] as const)('%s answers %s', async (name, decision) => {
      const bridge = createFakeHostBridge();
      renderBubble(bridge);
      act(() => bridge.emit(ask()));
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name }));
        await Promise.resolve();
      });
      expect(bridge.approvals).toEqual([{ approvalId: APPROVAL, decision }]);
    });

    it('shows a multi-line text whole, with no Details split', () => {
      const bridge = createFakeHostBridge();
      renderBubble(bridge);
      act(() => bridge.emit(ask({ summary: 'First I will look.\nThen I will move it.' })));
      const card = screen.getByRole('region', { name: 'Allow desktop__move_window?' });
      expect(card).toHaveTextContent('First I will look.');
      expect(card).toHaveTextContent('Then I will move it.');
      expect(screen.queryByText('Details')).toBeNull();
    });

    it('shows every open ask in turn: answering the first brings up the second', async () => {
      const bridge = createFakeHostBridge();
      renderBubble(bridge);
      act(() => bridge.emit(ask({ approvalId: 'a1', summary: 'Move the window.' })));
      act(() => bridge.emit(ask({ approvalId: 'a2', summary: 'Close the tab.' })));
      expect(screen.getByText('Move the window.')).toBeInTheDocument();
      expect(screen.queryByText('Close the tab.')).toBeNull();
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Allow once' }));
        await Promise.resolve();
      });
      expect(screen.getByText('Close the tab.')).toBeInTheDocument();
      expect(bridge.approvals).toEqual([{ approvalId: 'a1', decision: 'once' }]);
    });

    it('a dismissed ask removes its card and leaves the others', () => {
      const bridge = createFakeHostBridge();
      renderBubble(bridge);
      act(() => bridge.emit(ask({ approvalId: 'a1', summary: 'Move the window.' })));
      act(() => bridge.emit(ask({ approvalId: 'a2', summary: 'Close the tab.' })));
      act(() => bridge.emit({ type: 'connector.dismiss', approvalId: 'a2' }));
      expect(screen.getByText('Move the window.')).toBeInTheDocument();
      act(() => bridge.emit({ type: 'connector.dismiss', approvalId: 'a1' }));
      expect(screen.queryByRole('button', { name: 'Allow once' })).toBeNull();
    });

    it('a dismissed first ask hands over to the next', () => {
      const bridge = createFakeHostBridge();
      renderBubble(bridge);
      act(() => bridge.emit(ask({ approvalId: 'a1', summary: 'Move the window.' })));
      act(() => bridge.emit(ask({ approvalId: 'a2', summary: 'Close the tab.' })));
      act(() => bridge.emit({ type: 'connector.dismiss', approvalId: 'a1' }));
      expect(screen.getByText('Close the tab.')).toBeInTheDocument();
    });

    it('keeps the card when the answer did not get through (brain offline)', async () => {
      const bridge = createFakeHostBridge();
      bridge.approveTool = () => Promise.reject(new Error('brain offline'));
      renderBubble(bridge);
      act(() => bridge.emit(ask()));
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Allow once' }));
        await Promise.resolve();
      });
      expect(screen.getByRole('button', { name: 'Allow once' })).toBeInTheDocument();
    });

    it('a locked tool has no Always allow', () => {
      const bridge = createFakeHostBridge();
      renderBubble(bridge);
      act(() => bridge.emit(ask({ options: ['allow', 'deny'] })));
      expect(screen.getByRole('button', { name: 'Allow once' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Deny' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Always allow' })).toBeNull();
    });
  });

  it('says when a change cannot be undone', () => {
    const bridge = createFakeHostBridge();
    renderBubble(bridge);
    act(() => bridge.emit({ ...confirm(), risk: 'change' }));
    expect(
      screen.getByRole('region', { name: 'Change something in Notion?' }),
    ).not.toHaveTextContent('Can’t be undone');
    act(() => bridge.emit({ ...confirm(), risk: 'high' }));
    expect(screen.getByRole('region', { name: 'Change something in Notion?' })).toHaveTextContent(
      'Can’t be undone',
    );
  });

  it('goes away when the ask is answered elsewhere, and stays while it still waits', () => {
    const bridge = createFakeHostBridge();
    renderBubble(bridge);
    act(() => bridge.emit(confirm()));
    const still = {
      id: APPROVAL,
      kind: 'app-change' as const,
      petId: 'scout',
      summary: 'Create a page.',
      risk: 'change' as const,
      state: 'waiting' as const,
      createdAt: '2026-10-22T10:00:00.000Z',
    };
    act(() => bridge.emit({ type: 'asks.changed', waiting: [still] }));
    expect(screen.getByRole('button', { name: 'Allow once' })).toBeInTheDocument();
    act(() => bridge.emit({ type: 'asks.changed', waiting: [] }));
    expect(screen.queryByRole('button', { name: 'Allow once' })).toBeNull();
  });

  it('goes away when the turn ends', () => {
    const bridge = createFakeHostBridge();
    renderBubble(bridge);
    act(() => bridge.emit(confirm()));
    expect(screen.getByRole('button', { name: 'Allow once' })).toBeInTheDocument();
    act(() =>
      bridge.emit({ type: 'turn.error', turnId: TURN, code: 'aborted', message: 'Stopped.' }),
    );
    expect(screen.queryByRole('button', { name: 'Allow once' })).toBeNull();
  });
});
