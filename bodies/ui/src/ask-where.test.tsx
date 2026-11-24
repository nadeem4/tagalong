/** Tests for the Ask me card: the brain asks where an app should run, and the person may keep the answer. */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CompanionBubble } from './companion-bubble';
import { HostBridgeProvider, type BrainCard } from './host-bridge';
import type { TurnEvent } from './shapes';
import { createFakeHostBridge, type FakeHostBridge } from './test-support/fake-host-bridge';

const APPROVAL = '30000000-0000-4000-8000-000000000001';

const whereAsk: TurnEvent = {
  type: 'connector.confirm' as const,
  approvalId: APPROVAL,
  turnId: '',
  petId: 'scout',
  app: 'Claude Code',
  tool: 'question',
  question: true,
  summary: 'Where should Files run: on the brain, or on my-pc?',
  options: ['Brain', 'my-pc'],
  place: { app: 'files', body: 'node-this', name: 'Files' },
};

const REMOTE_CARD: BrainCard = {
  status: 'running',
  update: 'none',
  version: '1',
  build: 'x',
  model: 'm',
  appVersion: '1',
  appBuild: 'x',
  startedAt: null,
  startedBy: null,
  addr: '10.0.0.2:47321',
  pid: null,
  dataDir: '',
  logPath: '',
  places: [],
  workRunning: false,
  host: 'mini-pc',
  local: false,
};

async function open(bridge: FakeHostBridge) {
  render(
    <HostBridgeProvider bridge={bridge}>
      <CompanionBubble petId="scout" petName="Scout" expanded={false} />
    </HostBridgeProvider>,
  );
  act(() => bridge.emit(whereAsk));
  return screen.findByRole('region', { name: 'Where should Files run?' });
}

const press = async (name: string) => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }));
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe('the Ask me card', () => {
  it('offers This PC and the brain machine by name, with no typed answer', async () => {
    await open(createFakeHostBridge({ brainCard: REMOTE_CARD }));
    expect(await screen.findByRole('button', { name: 'mini-pc' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'This PC' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Brain' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Your answer' })).toBeNull();
  });

  it('answers without changing the row when the choice is not kept', async () => {
    const bridge = createFakeHostBridge({ brainCard: REMOTE_CARD });
    await open(bridge);
    await press('This PC');
    expect(bridge.jobAnswers).toEqual([{ approvalId: APPROVAL, option: 'my-pc' }]);
    expect(bridge.placementCalls).toEqual([]);
  });

  it.each([
    ['This PC', 'my-pc', 'app:files body'],
    ['mini-pc', 'Brain', 'app:files brain'],
  ])('Remember my choice, then %s, sets the row (%s)', async (button, option, call) => {
    const bridge = createFakeHostBridge({ brainCard: REMOTE_CARD });
    await open(bridge);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Remember my choice for Files' }));
    await press(button);
    expect(bridge.placementCalls).toEqual([call]);
    expect(bridge.jobAnswers).toEqual([{ approvalId: APPROVAL, option }]);
  });
});
