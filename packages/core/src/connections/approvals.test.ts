import { describe, expect, it } from 'vitest';
import type { ConnectorConfirmParams } from '@tagalong/protocol';
import { Approvals } from './approvals';

const ASK = {
  turnId: '6f1c1b8e-3b1c-4c8e-9a51-0b1f6f1d2a3c',
  petId: 'scout',
  app: 'Notion',
  tool: 'create_page',
  summary: 'Create a page.',
};

function setup(timeoutMs = 1_000) {
  const shown: ConnectorConfirmParams[] = [];
  return { approvals: new Approvals((p) => shown.push(p), timeoutMs), shown };
}

describe('Approvals', () => {
  it('shows the confirm and waits for Allow once', async () => {
    const { approvals, shown } = setup();
    const answer = approvals.ask(ASK, new AbortController().signal);
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject(ASK);
    expect(approvals.answer(shown[0]!.approvalId, 'once')).toBe(true);
    expect(await answer).toBe('allowed');
    expect(approvals.answer(shown[0]!.approvalId, 'once')).toBe(false);
  });

  it('Cancel says no', async () => {
    const { approvals, shown } = setup();
    const answer = approvals.ask(ASK, new AbortController().signal);
    approvals.answer(shown[0]!.approvalId, 'deny');
    expect(await answer).toBe('cancelled');
  });

  it('no answer in time, or a stopped turn, is a no', async () => {
    const { approvals } = setup(20);
    expect(await approvals.ask(ASK, new AbortController().signal)).toBe('timeout');
    const controller = new AbortController();
    const answer = approvals.ask(ASK, controller.signal);
    controller.abort();
    expect(await answer).toBe('cancelled');
  });
});
