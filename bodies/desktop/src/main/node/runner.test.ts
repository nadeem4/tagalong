/** The node process the desktop keeps beside a remote brain: started with the pairing, stopped without it. */
import { describe, expect, it } from 'vitest';
import { createNodeRunner, type NodeChild } from './runner';

type Link = { addrs: string[]; fp: string; lastGood?: string } | null;

function setup(initial: Link = null, token: string | null = 'tok') {
  const state = { link: initial, token };
  const started: NodeJS.ProcessEnv[] = [];
  const children: (NodeChild & { killed: boolean; exit: () => void })[] = [];
  const runner = createNodeRunner({
    link: { paired: () => state.link, token: () => state.token },
    nodeId: 'node-a1b2c3',
    spawn: (env) => {
      started.push(env);
      let onExit: () => void = () => undefined;
      const child = {
        killed: false,
        kill() {
          child.killed = true;
          onExit();
        },
        onExit(f: () => void) {
          onExit = f;
        },
        exit: () => onExit(),
      };
      children.push(child);
      return child;
    },
  });
  return { state, started, children, runner };
}

describe('node runner', () => {
  it('starts nothing while the desktop uses the brain on this PC', () => {
    const { runner, started } = setup(null);
    runner.sync();
    expect(started).toEqual([]);
  });

  it('starts a node with the pairing in its environment, not its arguments', () => {
    const { runner, started } = setup({ addrs: ['10.0.0.5:47323'], fp: 'ab'.repeat(32) });
    runner.sync();
    expect(started).toEqual([
      {
        TAGALONG_NODE_ADDR: '10.0.0.5:47323',
        TAGALONG_NODE_FP: 'ab'.repeat(32),
        TAGALONG_NODE_TOKEN: 'tok',
        TAGALONG_NODE_ID: 'node-a1b2c3',
      },
    ]);
  });

  it('dials the address that last worked', () => {
    const { runner, started } = setup({
      addrs: ['10.0.0.5:47323', '100.64.0.2:47323'],
      fp: 'ab'.repeat(32),
      lastGood: '100.64.0.2:47323',
    });
    runner.sync();
    expect(started[0]?.TAGALONG_NODE_ADDR).toBe('100.64.0.2:47323');
  });

  it('keeps one node running while nothing changed', () => {
    const { runner, started } = setup({ addrs: ['h:1'], fp: 'ab'.repeat(32) });
    runner.sync();
    runner.sync();
    expect(started).toHaveLength(1);
  });

  it('replaces the node when the pairing changes', () => {
    const { runner, state, started, children } = setup({ addrs: ['h:1'], fp: 'ab'.repeat(32) });
    runner.sync();
    state.link = { addrs: ['h:2'], fp: 'cd'.repeat(32) };
    runner.sync();
    expect(children[0]?.killed).toBe(true);
    expect(started).toHaveLength(2);
  });

  it('stops the node when the desktop goes back to the local brain', () => {
    const { runner, state, children } = setup({ addrs: ['h:1'], fp: 'ab'.repeat(32) });
    runner.sync();
    state.link = null;
    runner.sync();
    expect(children[0]?.killed).toBe(true);
  });

  it('starts nothing without a readable token', () => {
    const { runner, started } = setup({ addrs: ['h:1'], fp: 'ab'.repeat(32) }, null);
    runner.sync();
    expect(started).toEqual([]);
  });

  it('starts it again after it exits', () => {
    const { runner, children, started } = setup({ addrs: ['h:1'], fp: 'ab'.repeat(32) });
    runner.sync();
    children[0]?.exit();
    runner.sync();
    expect(started).toHaveLength(2);
  });
});
