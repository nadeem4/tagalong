/** Tests for the watch_for tool: its description, which display it watches, and its refusals. */
import { describe, expect, it } from 'vitest';
import type { Pet } from '@tagalong/protocol';
import type { PerceptionHost } from '../../perception/host';
import { FakeClock } from '../../watch/fake-clock';
import { WatchManager } from '../../watch/watch-manager';
import { fakeTurn } from '../fake-turn';
import { WATCH_FOR, watchForTool } from './awareness';

const pet: Pet = {
  id: 'scout',
  name: 'Scout',
  avatar: '🐾',
  model: 'claude-opus-5',
  providerId: 'anthropic',
  roleId: 'companion',
};

function host(): PerceptionHost {
  return {
    capabilities: ['displays', 'recall', 'textLayer'],
    capture: () => Promise.resolve({}),
    diff: () => Promise.resolve({ changeRatio: 0, afterAt: new Date(0).toISOString() }),
    listWindows: () =>
      Promise.resolve({
        windows: [
          {
            id: 'w-term',
            processName: 'WindowsTerminal.exe',
            title: 'npm run build',
            displayId: 2,
            state: 'foreground',
            browser: false,
          },
          {
            id: 'w-edit',
            processName: 'Code.exe',
            title: 'app.ts',
            displayId: 1,
            state: 'background',
            browser: false,
          },
        ],
      }),
  };
}

function setup(hosts: PerceptionHost[] = [host()]) {
  const manager = new WatchManager({
    clock: new FakeClock(0),
    hosts: () => hosts,
    provider: () => {
      throw new Error('no checks in these tests');
    },
    limits: () => ({ maxChecks: 60, maxConcurrent: 3, defaultTimeoutMinutes: 30 }),
    emit: () => undefined,
  });
  const tool = watchForTool({ manager, hosts: () => hosts });
  const turn = fakeTurn({ pet, turnId: 't1' });
  return { manager, tool, turn };
}

describe('watch_for', () => {
  it('describes a condition, a timeout and that the user will be shown the result', () => {
    const { tool } = setup();
    expect(tool.definition.name).toBe(WATCH_FOR);
    expect(tool.definition.inputSchema['required']).toEqual(['condition']);
    expect(tool.definition.description).toMatch(/condition/i);
  });

  it('watches the display of the window in front, and reads that window if it must', async () => {
    const { tool, manager, turn } = setup();
    const outcome = await tool.run({ condition: 'the build finishes' }, turn);

    expect(outcome.isError).toBeFalsy();
    expect(manager.active()).toEqual([
      expect.objectContaining({ petId: 'scout', displayId: 2, condition: 'the build finishes' }),
    ]);
    expect(String(outcome.content)).toMatch(/display 2/);
    expect(String(outcome.content)).toMatch(/30 minutes/);
  });

  it('takes a display and a timeout the pet names', async () => {
    const { tool, manager, turn } = setup();
    const outcome = await tool.run(
      { condition: 'a new email arrives', displayId: 1, timeoutMinutes: 10 },
      turn,
    );
    expect(manager.active()[0]?.displayId).toBe(1);
    expect(String(outcome.content)).toMatch(/10 minutes/);
  });

  it('refuses without a condition', async () => {
    const { tool, turn } = setup();
    const outcome = await tool.run({}, turn);
    expect(outcome.isError).toBe(true);
  });

  it('passes on the refusal when too many watches run', async () => {
    const { tool, turn } = setup();
    for (let i = 0; i < 3; i += 1) await tool.run({ condition: `c${i}` }, turn);
    const outcome = await tool.run({ condition: 'one too many' }, turn);
    expect(outcome.isError).toBe(true);
    expect(String(outcome.content)).toMatch(/at once/);
  });

  it('asks for a display when there is no window list to find one', async () => {
    const bare: PerceptionHost = {
      capabilities: ['recall'],
      capture: () => Promise.resolve({}),
      diff: () => Promise.resolve({ changeRatio: 0, afterAt: new Date(0).toISOString() }),
    };
    const { tool, turn } = setup([bare]);
    const outcome = await tool.run({ condition: 'x' }, turn);
    expect(outcome.isError).toBe(true);
    expect(String(outcome.content)).toMatch(/displayId/);
  });
});
