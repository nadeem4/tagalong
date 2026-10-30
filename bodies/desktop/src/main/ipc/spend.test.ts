/** Tests for the Spend IPC. */

import { describe, expect, it } from 'vitest';
import { IPC } from '../../shared/ipc';
import { fakeIpc } from './fake-ipc';
import { registerSpendIpc } from './spend';

let spend: () => unknown = () => [];
const spendText = (value: unknown) => [{ type: 'text', text: JSON.stringify(value) }];

function setup() {
  const ipc = fakeIpc();
  const brainCalls: [string, object | undefined][] = [];
  const brain = {
    call: (tool: string, input?: object) => {
      brainCalls.push([tool, input]);
      return Promise.resolve(spend() as never);
    },
  };
  registerSpendIpc(ipc.handle, { brain });
  return { ...ipc, brainCalls };
}

describe('registerSpendIpc', () => {
  it("reads Home's Spend card from the brain's spend_today", async () => {
    spend = () => spendText({ spent_usd: 0.31, limit_usd: 1 });
    const { invoke, brainCalls } = setup();
    expect(await invoke(IPC.usageSummary)).toEqual({ spentUsd: 0.31, limitUsd: 1 });
    expect(brainCalls).toEqual([['spend_today', {}]]);
  });

  it('shows no limit when the brain has none, and rejects an answer it cannot read', async () => {
    spend = () => spendText({ spent_usd: 0, limit_usd: null });
    expect(await setup().invoke(IPC.usageSummary)).toEqual({ spentUsd: 0, limitUsd: null });
    spend = () => spendText({ nope: true });
    await expect(setup().invoke(IPC.usageSummary)).rejects.toThrow('brain sent bad spend');
  });
});
