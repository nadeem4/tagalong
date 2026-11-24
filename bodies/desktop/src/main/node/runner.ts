/**
 * Keeps the node process beside a remote brain: while this desktop is paired it runs
 * `tagalong node run` so the brain can use tools on this PC, and it stops it when the desktop
 * goes back to the brain on this PC. The pairing reaches the node through its environment (the
 * token must not show in a process list) and the node's own allow-list decides what may run.
 */
import type { LinkStore } from '../brain/link-store';

export interface NodeChild {
  kill(): void;
  /** Called once when the process is gone, however it ended. */
  onExit(listener: () => void): void;
}

interface NodeRunnerOptions {
  link: Pick<LinkStore, 'paired' | 'token'>;
  /** The node's body id, unique to this install. */
  nodeId: string;
  spawn: (env: NodeJS.ProcessEnv) => NodeChild;
  /** TAGALONG_START_BRAIN=0: the app starts no processes of its own (the e2e suites run so). */
  disabled?: boolean;
}

export function createNodeRunner({ link, nodeId, spawn, disabled = false }: NodeRunnerOptions): {
  sync(): void;
  stop(): void;
} {
  let running: { key: string; child: NodeChild } | null = null;

  const stop = (): void => {
    const current = running;
    running = null;
    current?.child.kill();
  };

  const sync = (): void => {
    if (disabled) return;
    const paired = link.paired();
    const token = paired === null ? null : link.token();
    if (paired === null || token === null) return stop();
    const addr = paired.lastGood ?? paired.addrs[0];
    if (addr === undefined) return stop();
    const key = JSON.stringify([addr, paired.fp, token]);
    if (running?.key === key) return;
    stop();
    const child = spawn({
      TAGALONG_NODE_ADDR: addr,
      TAGALONG_NODE_FP: paired.fp,
      TAGALONG_NODE_TOKEN: token,
      TAGALONG_NODE_ID: nodeId,
    });
    const entry = { key, child };
    running = entry;
    child.onExit(() => {
      if (running === entry) running = null;
    });
  };

  return { sync, stop };
}
