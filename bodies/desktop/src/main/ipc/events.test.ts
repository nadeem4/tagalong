/** Tests for the events IPC: the Waiting tab reads through the brain's events_waiting tool. */

import { describe, expect, it } from 'vitest';
import { IPC } from '../../shared/ipc';
import { fakeIpc } from './fake-ipc';
import { registerEventsIpc } from './events';

describe('registerEventsIpc', () => {
  it('reads the waiting events and parses them', async () => {
    const ipc = fakeIpc();
    const wire = {
      waiting: [
        {
          id: 'e1',
          kind: 'job_done',
          source: 'job:j1',
          at: '2026-11-17T10:00:00+00:00',
          age_s: 5,
          gave_up: false,
          gist: 'Done',
        },
      ],
    };
    const calls: string[] = [];
    const brain = {
      call: (tool: string) => {
        calls.push(tool);
        return Promise.resolve([
          { type: 'text' as const, text: JSON.stringify(wire) },
        ]) as Promise<never>;
      },
    };
    registerEventsIpc(ipc.handle, { brain });
    expect(await ipc.invoke(IPC.eventsWaiting)).toEqual([
      { id: 'e1', ageS: 5, gaveUp: false, gist: 'Done' },
    ]);
    expect(calls).toEqual(['events_waiting']);
  });
});
