/** The real command runner, on Node itself: output, stdin, and a command that is missing. */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCommand } from './run-command';

describe('runCommand', () => {
  it('returns what the command printed and feeds it stdin', async () => {
    const result = await runCommand('node', ['-e', 'process.stdin.pipe(process.stdout)'], {
      input: 'hi',
    });
    expect(result).toMatchObject({ code: 0, stdout: 'hi' });
  });

  it('answers as soon as the awaited text appears, without waiting for the command to end', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'run-'));
    const script = join(dir, 'slow.js');
    writeFileSync(script, "console.log('ready'); setTimeout(() => {}, 20000);");
    const started = Date.now();
    try {
      const result = await runCommand('node', [script], { until: 'ready' });
      expect(result.stdout).toContain('ready');
      expect(Date.now() - started).toBeLessThan(10_000);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports a command that does not exist as a failure, not a throw', async () => {
    const result = await runCommand('tagalong-no-such-command', []);
    expect(result.code).not.toBe(0);
  });
});
