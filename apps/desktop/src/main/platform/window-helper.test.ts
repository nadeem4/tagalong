/** Tests for the window list script and runWindowHelper. */

import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LIST_WINDOWS_SCRIPT, encodePowerShellCommand, runWindowHelper } from './window-helper';
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

  it('hands the script over as one encoded argument, not over stdin', async () => {
    // One encoded argument, never stdin: `powershell -Command -` parses a script line by
    // line, so any block spanning lines produces nothing, with exit 0 and no error.
    const child = new FakeChild();
    let encoded = '';
    const run = runWindowHelper(
      (argument) => {
        encoded = argument;
        return child;
      },
      'Write-Output 1',
      3000,
    );

    expect(Buffer.from(encoded, 'base64').toString('utf16le')).toBe('Write-Output 1');

    child.finish();
    await run;
  });

  it('hands data to the script on stdin when there is some, and closes it', async () => {
    // A picture to read goes this way: it is too large for the command line, and it must
    // never be written to disk.
    const child = new FakeChild();
    const run = runWindowHelper(() => child, 'x', 3000, 'cG5n');

    expect(child.written).toEqual(['cG5n']);
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
    // Three seconds at most, returning partial output rather than an error: a slow window
    // must not hold up the ask behind it.
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

describe('encodePowerShellCommand', () => {
  it('round-trips a multi-line script through UTF-16LE base64', () => {
    const script = ['foreach ($i in @(1,2)) {', '  Write-Output $i', '}', ''].join('\n');
    expect(Buffer.from(encodePowerShellCommand(script), 'base64').toString('utf16le')).toBe(script);
  });

  it('stays far inside the Windows command-line limit', () => {
    // Base64 of UTF-16LE is about 2.7x the source. Windows allows roughly 32,000
    // characters, and a script that outgrew that would fail as an unexplained spawn
    // error rather than anything legible.
    expect(encodePowerShellCommand(LIST_WINDOWS_SCRIPT).length).toBeLessThan(30_000);
  });
});

describe('the scripts and the transport that carries them', () => {
  it('uses no here-string, which PowerShell swallows however it is fed', () => {
    // Not a style rule. Feeding `Add-Type @"..."@` to `powershell -Command -` makes the
    // process exit 0, print nothing and report no error — and every statement after it is
    // lost with it. The enumeration returned an empty desktop on a machine with eleven
    // windows open, and nothing anywhere said why.
    //
    // Running the same text as a .ps1 file works, which is what makes this so easy to
    // miss: the script is correct and the transport is not.
    expect(LIST_WINDOWS_SCRIPT).not.toContain('@"');
  });

  it('still defines the window helpers it needs from user32', () => {
    for (const entry of ['IsIconic', 'IsWindowVisible', 'GetForegroundWindow']) {
      expect(LIST_WINDOWS_SCRIPT).toContain(entry);
    }
  });
});
