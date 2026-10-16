/** Tests for PickUpCard and the bubble showing it. */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PickUpReadyParams } from '@tagalong/protocol';
import { CompanionBubble } from './companion-bubble';
import { HostBridgeProvider, type HostBridge } from './host-bridge';
import { PickUpCard } from './pick-up-card';
import { createFakeHostBridge } from './test-support/fake-host-bridge';

const ready: PickUpReadyParams = {
  text: 'Yesterday you were in ai_pet on feat/x.',
  items: [
    {
      id: 'p1',
      kind: 'project',
      name: 'ai_pet',
      path: 'C:\\projects\\ai_pet',
      editor: 'vscode',
      branch: 'feat/x',
    },
    { id: 'p2', kind: 'project', name: 'api', path: 'C:\\api', editor: 'other' },
    {
      id: 'h1',
      kind: 'handoff',
      expertName: 'Claude Code',
      ask: 'fix the e2e tests',
      state: 'stopped',
    },
  ],
};

function bridgeWith(over: Partial<HostBridge> = {}) {
  return {
    ...createFakeHostBridge(),
    openPickUp: vi.fn(() => Promise.resolve()),
    rebriefPickUp: vi.fn(() => Promise.resolve()),
    dismissPickUp: vi.fn(() => Promise.resolve()),
    ...over,
  };
}

function renderCard(bridge: HostBridge, onDone = vi.fn()) {
  render(
    <HostBridgeProvider bridge={bridge}>
      <PickUpCard pickUp={ready} onDone={onDone} />
    </HostBridgeProvider>,
  );
  return onDone;
}

const flush = () => act(async () => await Promise.resolve());

describe('PickUpCard', () => {
  it('lists each item with its own button, and opens nothing on render', () => {
    const bridge = bridgeWith();
    renderCard(bridge);
    const card = screen.getByRole('region', { name: 'Pick up where you left off' });
    expect(card).toHaveTextContent('ai_pet');
    expect(card).toHaveTextContent('C:\\projects\\ai_pet, branch feat/x');
    expect(card).toHaveTextContent('Claude Code: “fix the e2e tests” (stopped)');
    expect(screen.getByRole('button', { name: 'Open ai_pet in VS Code' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open the api folder' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Brief Claude Code again' })).toBeInTheDocument();
    expect(bridge.openPickUp).not.toHaveBeenCalled();
    expect(bridge.rebriefPickUp).not.toHaveBeenCalled();
    expect(bridge.dismissPickUp).not.toHaveBeenCalled();
  });

  it('opens one project by its id on a click, and says when it is open', async () => {
    const bridge = bridgeWith();
    renderCard(bridge);
    fireEvent.click(screen.getByRole('button', { name: 'Open ai_pet in VS Code' }));
    await flush();
    expect(bridge.openPickUp).toHaveBeenCalledWith('p1');
    expect(screen.getByRole('button', { name: 'Open ai_pet in VS Code' })).toHaveTextContent(
      'Opened',
    );
  });

  it('says so when a project could not be opened', async () => {
    const bridge = bridgeWith({ openPickUp: vi.fn(() => Promise.reject(new Error('gone'))) });
    renderCard(bridge);
    fireEvent.click(screen.getByRole('button', { name: 'Open the api folder' }));
    await flush();
    expect(screen.getByRole('alert')).toHaveTextContent('Could not open api.');
  });

  it('briefs again into the hand-off card and closes', async () => {
    const bridge = bridgeWith();
    const onDone = renderCard(bridge);
    fireEvent.click(screen.getByRole('button', { name: 'Brief Claude Code again' }));
    await flush();
    expect(bridge.rebriefPickUp).toHaveBeenCalledWith('h1');
    expect(onDone).toHaveBeenCalled();
  });

  it('drops the lot on Not now', async () => {
    const bridge = bridgeWith();
    const onDone = renderCard(bridge);
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    await flush();
    expect(bridge.dismissPickUp).toHaveBeenCalledOnce();
    expect(onDone).toHaveBeenCalled();
    expect(bridge.openPickUp).not.toHaveBeenCalled();
  });
});

describe('the bubble with a pick-up', () => {
  it('opens on the card, and leaves it once done', async () => {
    const bridge = bridgeWith();
    const onPickUpDone = vi.fn();
    render(
      <HostBridgeProvider bridge={bridge}>
        <CompanionBubble petId="scout" petName="Scout" pickUp={ready} onPickUpDone={onPickUpDone} />
      </HostBridgeProvider>,
    );
    expect(screen.getByRole('region', { name: 'Pick up where you left off' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    await flush();
    expect(onPickUpDone).toHaveBeenCalled();
  });
});
