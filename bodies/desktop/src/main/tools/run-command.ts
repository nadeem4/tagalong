/**
 * Runs one command and collects its output, for the tool that sets AI tools up. Every argument
 * is a constant of ours or a path, never text from a person or a model. On Windows the tools
 * are `.cmd` files that only a shell can start, so those run in one; `where` and `icacls` are
 * programs and take paths with spaces, so they do not.
 */
import { spawn } from 'node:child_process';
import type { RunResult } from './connect-ai-tool';

const PROGRAMS = new Set(['where', 'icacls']);
const LIMIT_MS = 30_000;

export function runCommand(
  command: string,
  args: string[],
  opts?: { input?: string },
): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      shell: process.platform === 'win32' && !PROGRAMS.has(command),
      windowsHide: true,
      timeout: LIMIT_MS,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => void (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => void (stderr += chunk.toString()));
    child.once('error', (error) => resolve({ code: 1, stdout, stderr: error.message }));
    child.once('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.stdin.on('error', () => undefined);
    child.stdin.end(opts?.input ?? '');
  });
}
