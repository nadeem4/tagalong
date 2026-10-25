/** Tests for the connector confirm card: Allow once and Cancel. */

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

  it('Cancel answers no', async () => {
    const bridge = createFakeHostBridge();
    renderBubble(bridge, true);
    act(() => bridge.emit(confirm()));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      await Promise.resolve();
    });
    expect(bridge.approvals).toEqual([{ approvalId: APPROVAL, decision: 'deny' }]);
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
