import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LIST_WINDOWS_SCRIPT, runWindowHelper } from './window-helper';
import type { HelperChild } from './window-helper';

class FakeChild extends EventEmitter implements HelperChild {
  readonly stdout = new EventEmitter();
  readonly written: string[] = [];
  ended = false;
  killed = false;

  readonly stdin = {
    write: (chunk: string) => {
      this.written.push(chunk);
    },
    end: () => {
      this.ended = true;
    },
  };

  kill(): void {
    this.killed = true;
  }

  say(text: string): void {
    this.stdout.emit('data', Buffer.from(text, 'utf8'));
  }

  finish(): void {
    this.emit('close', 0);
  }
}

describe('LIST_WINDOWS_SCRIPT', () => {
  it('asks UI Automation for top-level windows only', () => {
    expect(LIST_WINDOWS_SCRIPT).toContain('UIAutomationClient');
    expect(LIST_WINDOWS_SCRIPT).toContain('TreeScope]::Children');
  });

  it('reports the two flags the parser derives state from', () => {
    expect(LIST_WINDOWS_SCRIPT).toContain('IsIconic');
    expect(LIST_WINDOWS_SCRIPT).toContain('GetForegroundWindow');
  });

  it('reads no window contents', () => {
    // The inventory is cheap because it never walks a window's descendants. Task 4 adds
    // the text layer as a separate, deliberate call against one window.
    expect(LIST_WINDOWS_SCRIPT).not.toContain('Descendants');
    expect(LIST_WINDOWS_SCRIPT).not.toContain('ValuePattern');
  });

  it('emits an array even for a single window', () => {
    // ConvertTo-Json unwraps a one-element array unless the input is forced to a list.
    expect(LIST_WINDOWS_SCRIPT).toContain('@(');
  });
});

describe('runWindowHelper', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('feeds the script in over stdin and closes it', async () => {
    const child = new FakeChild();
    const run = runWindowHelper(() => child, 'Write-Output 1', 3000);

    expect(child.written.join('')).toContain('Write-Output 1');
    expect(child.ended).toBe(true);

    child.finish();
    await run;
  });

  it('resolves with everything the helper printed', async () => {
    const child = new FakeChild();
    const run = runWindowHelper(() => child, 'x', 3000);

    child.say('[{"handle":1,');
    child.say('"processName":"Code.exe"}]');
    child.finish();

    expect(await run).toBe('[{"handle":1,"processName":"Code.exe"}]');
  });

  it('returns partial output and kills the helper when it overruns', async () => {
    // The phase page asks for a three second timeout with partial output rather than an
    // error. A slow window must not hold up the ask behind it.
    const child = new FakeChild();
    const run = runWindowHelper(() => child, 'x', 3000);

    child.say('[{"handle":1}');
    await vi.advanceTimersByTimeAsync(3000);

    expect(await run).toBe('[{"handle":1}');
    expect(child.killed).toBe(true);
  });

  it('ignores a close that arrives after the timeout already answered', async () => {
    const child = new FakeChild();
    const run = runWindowHelper(() => child, 'x', 3000);

    child.say('early');
    await vi.advanceTimersByTimeAsync(3000);
    child.say(' late');
    child.finish();

    expect(await run).toBe('early');
  });

  it('answers with nothing when the helper cannot start at all', async () => {
    // PowerShell missing, blocked by policy, or the machine is not Windows. The pet keeps
    // its other senses rather than the whole ask failing.
    const child = new FakeChild();
    const run = runWindowHelper(() => child, 'x', 3000);

    child.emit('error', new Error('spawn powershell ENOENT'));

    expect(await run).toBe('');
  });

  it('answers with nothing when the spawn itself throws', async () => {
    const run = runWindowHelper(
      () => {
        throw new Error('ENOENT');
      },
      'x',
      3000,
    );

    expect(await run).toBe('');
  });

  it('stops collecting once the output is absurdly large', async () => {
    // A helper that loops must not fill the main process's heap before the timeout.
    const child = new FakeChild();
    const run = runWindowHelper(() => child, 'x', 3000);

    for (let index = 0; index < 200; index += 1) child.say('y'.repeat(10_000));
    child.finish();

    expect((await run).length).toBeLessThanOrEqual(1_000_000);
  });
});
