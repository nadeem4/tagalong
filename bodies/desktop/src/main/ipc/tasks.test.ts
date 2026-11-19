/** Tests for the tasks IPC: the Tasks page reads through the brain's tasks_list tool. */

import { describe, expect, it } from 'vitest';
import { IPC } from '../../shared/ipc';
import { fakeIpc } from './fake-ipc';
import { registerTasksIpc } from './tasks';

describe('registerTasksIpc', () => {
  it('returns the parsed rows', async () => {
    const ipc = fakeIpc();
    const wire = {
      tasks: [
        {
          id: 't1',
          kind: 'own',
          state: 'open',
          title: 'Tidy notes',
          source: 'desktop',
          caused_by: null,
          chain: [],
          created_at: '2026-11-17T10:00:00+00:00',
          ended_at: null,
        },
      ],
    };
    const calls: unknown[][] = [];
    const brain = {
      call: (tool: string, input?: unknown) => {
        calls.push([tool, input]);
        return Promise.resolve([
          { type: 'text' as const, text: JSON.stringify(wire) },
        ]) as Promise<never>;
      },
    };
    registerTasksIpc(ipc.handle, { brain });
    const rows = (await ipc.invoke(IPC.tasksList)) as { id: string; title: string }[];
    expect(rows.map((r) => [r.id, r.title])).toEqual([['t1', 'Tidy notes']]);
    expect(calls).toEqual([['tasks_list', { include_ended: true }]]);
  });
});
