/** Tests for the Ask me card: the brain asks where an app should run, and the person may keep the answer. */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CompanionBubble } from './companion-bubble';
import { HostBridgeProvider } from './host-bridge';
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
  place: { app: 'files', body: 'node-this' },
};

async function open(bridge: FakeHostBridge) {
  render(
    <HostBridgeProvider bridge={bridge}>
      <CompanionBubble petId="scout" petName="Scout" expanded={false} />
    </HostBridgeProvider>,
  );
  act(() => bridge.emit(whereAsk));
  return screen.findByRole('region', { name: /^Where should Files run/ });
}

const press = async (name: string) => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }));
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe('the Ask me card', () => {
  it('offers the two places, with no typed answer', async () => {
    await open(createFakeHostBridge());
    expect(screen.getByRole('button', { name: 'Brain' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'my-pc' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Your answer' })).toBeNull();
  });

  it('answers without changing the row when the choice is not kept', async () => {
    const bridge = createFakeHostBridge();
    await open(bridge);
    await press('my-pc');
    expect(bridge.jobAnswers).toEqual([{ approvalId: APPROVAL, option: 'my-pc' }]);
    expect(bridge.placementCalls).toEqual([]);
  });

  it.each([
    ['my-pc', 'app:files body'],
    ['Brain', 'app:files brain'],
  ])('Remember my choice, then %s, sets the row (%s)', async (option, call) => {
    const bridge = createFakeHostBridge();
    await open(bridge);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Remember my choice' }));
    await press(option);
    expect(bridge.placementCalls).toEqual([call]);
    expect(bridge.jobAnswers).toEqual([{ approvalId: APPROVAL, option }]);
  });
});
