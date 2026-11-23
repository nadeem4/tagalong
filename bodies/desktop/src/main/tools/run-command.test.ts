/** The real command runner, on Node itself: output, stdin, and a command that is missing. */
import { describe, expect, it } from 'vitest';
import { runCommand } from './run-command';

describe('runCommand', () => {
  it('returns what the command printed and feeds it stdin', async () => {
    const result = await runCommand('node', ['-e', 'process.stdin.pipe(process.stdout)'], {
      input: 'hi',
    });
    expect(result).toMatchObject({ code: 0, stdout: 'hi' });
  });

  it('reports a command that does not exist as a failure, not a throw', async () => {
    const result = await runCommand('tagalong-no-such-command', []);
    expect(result.code).not.toBe(0);
  });
});
