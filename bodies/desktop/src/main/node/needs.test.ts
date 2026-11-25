/**
 * Tests for the requests a remote brain leaves on this PC: what the card shows, what a click runs,
 * what "not now" keeps, and the approved list.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { NeedsYouItem } from '@tagalong/ui/shapes';
import { createNeedsYou, onPath } from './needs';

const open = (over: object = {}) => ({
  seq: 1,
  id: 'n1',
  state: 'open',
  node: 'node-1',
  need: 'approve',
  spec: { command: 'claude-agent-acp', args: ['--stdio'] },
  expert: 'claude-code',
  ...over,
});

function rig(
  run: (args: string[]) => Promise<{ code: number; out: string }> = async () => ({
    code: 0,
    out: '',
  }),
) {
  const calls: string[][] = [];
  const answers: Array<[string, string]> = [];
  const pushed: NeedsYouItem[][] = [];
  const needs = createNeedsYou({
    run: async (args) => {
      calls.push(args);
      return run(args);
    },
    answer: async (id, outcome) => void answers.push([id, outcome]),
    resolve: (command) =>
      command === 'claude-agent-acp' ? 'C:\\tools\\claude-agent-acp.cmd' : null,
    brain: () => 'mini-pc',
    push: (items) => void pushed.push(items),
  });
  return { needs, calls, answers, pushed };
}

describe('needs you on this PC', () => {
  it('shows what this PC resolves and who is asking, not text from the frame', () => {
    const { needs, pushed } = rig();
    needs.frame(
      open({ spec: { command: 'claude-agent-acp', args: [] }, brain: 'evil', path: 'C:\\x' }),
    );
    expect(needs.list()).toEqual([
      expect.objectContaining({
        id: 'n1',
        need: 'approve',
        brain: 'mini-pc',
        what: 'claude-agent-acp',
        path: 'C:\\tools\\claude-agent-acp.cmd',
        state: 'waiting',
        bubble: true,
      }),
    ]);
    expect(pushed).toHaveLength(1);
  });

  it('allow runs the allow command with the exact program and arguments, then tells the brain', async () => {
    const { needs, calls, answers } = rig();
    needs.frame(open({ spec: { command: 'claude-agent-acp', args: ['--stdio', 'a b'] } }));
    expect(await needs.act('n1')).toEqual({});
    expect(calls).toEqual([['node', 'allow', 'claude-agent-acp', '--', '--stdio', 'a b']]);
    expect(answers).toEqual([['n1', 'done']]);
    expect(needs.list()).toEqual([]);
  });

  it('allow of an address uses --url', async () => {
    const { needs, calls } = rig();
    needs.frame(open({ spec: { url: 'https://mcp.example/x' } }));
    await needs.act('n1');
    expect(calls).toEqual([['node', 'allow', '--url', 'https://mcp.example/x']]);
  });

  it('install and sign-in run the expert commands', async () => {
    const { needs, calls } = rig();
    needs.frame(open({ id: 'i', need: 'install' }));
    needs.frame(open({ id: 's', need: 'signin' }));
    await needs.act('i');
    await needs.act('s');
    expect(calls).toEqual([
      ['install', 'claude-code'],
      ['login', 'claude-code'],
    ]);
  });

  it('a failed command keeps the request, with the last line of why, and tells the brain nothing', async () => {
    const { needs, answers } = rig(async () => ({ code: 1, out: 'starting\nno network' }));
    needs.frame(open());
    expect(await needs.act('n1')).toEqual({ error: 'no network' });
    expect(answers).toEqual([]);
    expect(needs.list()[0]).toMatchObject({ state: 'failed', failure: 'no network' });
  });

  it('not now closes the bubble, keeps the request in Home and tells the brain', async () => {
    const { needs, answers } = rig();
    needs.frame(open());
    await needs.notNow('n1');
    expect(answers).toEqual([['n1', 'not_now']]);
    expect(needs.list()[0]).toMatchObject({ bubble: false, state: 'waiting' });
  });

  it('a closed frame removes the request', () => {
    const { needs } = rig();
    needs.frame(open());
    needs.frame({ seq: 2, id: 'n1', state: 'closed', reason: 'timeout' });
    expect(needs.list()).toEqual([]);
  });

  it('lists what is approved here, and revokes one by its key', async () => {
    const { needs, calls } = rig(async (args) =>
      args[1] === 'list'
        ? {
            code: 0,
            out: JSON.stringify([
              {
                key: 'k1',
                command: 'claude',
                args: ['--x'],
                path: 'C:\\c.exe',
                at: '2026-11-01T10:00:00+00:00',
              },
              { key: 'k2', url: 'https://m.example' },
            ]),
          }
        : { code: 0, out: '' },
    );
    expect(await needs.approved()).toEqual([
      { key: 'k1', what: 'claude --x', path: 'C:\\c.exe', at: '2026-11-01T10:00:00+00:00' },
      { key: 'k2', what: 'https://m.example' },
    ]);
    await needs.revoke('k1');
    expect(calls.at(-1)).toEqual(['node', 'revoke', 'k1']);
  });
});

describe('onPath', () => {
  it('finds a program the way the shell would, trying the PATHEXT endings', () => {
    const dir = mkdtempSync(join(tmpdir(), 'needs-'));
    writeFileSync(join(dir, 'claude-agent-acp.cmd'), '');
    expect(onPath('claude-agent-acp', { PATH: dir, PATHEXT: '.exe;.cmd' })).toBe(
      join(dir, 'claude-agent-acp.cmd'),
    );
    expect(onPath('nothing-here', { PATH: dir, PATHEXT: '.exe;.cmd' })).toBeNull();
  });
});
