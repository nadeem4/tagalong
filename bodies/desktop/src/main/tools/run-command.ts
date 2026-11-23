/**
 * Runs one command and collects its output, for the tool that sets AI tools up. Every argument
 * is a constant of ours or a path, never text from a person or a model. On Windows the tools
 * are `.cmd` files that only a shell can start, so those run in one; `where` and `icacls` are
 * programs and take paths with spaces, so they do not.
 */
import { spawn } from 'node:child_process';
import type { RunOptions, RunResult } from './connect-ai-tool';

const PROGRAMS = new Set(['where', 'icacls']);

export function runCommand(
  command: string,
  args: string[],
  opts: RunOptions = {},
): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      shell: process.platform === 'win32' && !PROGRAMS.has(command),
      windowsHide: true,
      timeout: opts.timeoutMs ?? 30_000,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      if (opts.until !== undefined && stdout.includes(opts.until)) {
        resolve({ code: 0, stdout, stderr });
        child.kill();
      }
    });
    child.stderr.on('data', (chunk: Buffer) => void (stderr += chunk.toString()));
    child.once('error', (error) => resolve({ code: 1, stdout, stderr: error.message }));
    child.once('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.stdin.on('error', () => undefined);
    child.stdin.end(opts.input ?? '');
  });
}
