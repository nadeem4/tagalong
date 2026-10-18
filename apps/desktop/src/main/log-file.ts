/**
 * The log file: the app's warnings and errors, kept on disk so a person can send them when
 * something goes wrong. Contains logLine, installLogFile, rendererConsole and openLogsFolder.
 * The engine runs in main's process, so core's warnings land here too; the windows' come in
 * through rendererConsole and the voice process's through forwardConsole (log-text.ts).
 *
 * Privacy: a line keeps only a text first argument and, for an Error, its name and
 * message; every other argument becomes its type, so no speech, screen text or turn
 * payload can ride in through an object. Secrets are hidden and a line is cut at 300
 * characters. Review rule: never put speech, screen or file text in console.warn/error's
 * first argument.
 */

import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { hideSecrets } from '@tagalong/core';
import { keptText } from './log-text';
import type { Level } from './log-text';

const MAX_LINE = 300;
const MAX_FILE = 1024 * 1024;

/** One log line: time, level, the kept text, secrets hidden, on one line, at most 300 chars. */
export function logLine(level: Level, args: readonly unknown[], now: Date): string {
  const line = `${now.toISOString()} ${level.toUpperCase()} ${hideSecrets(keptText(args))}`;
  return line.replace(/\s*[\r\n]+\s*/g, ' ').slice(0, MAX_LINE);
}

/**
 * Wraps console.warn and console.error (the originals still run) so each call also appends
 * a line to `<dir>/tagalong.log`. Past 1 MB the file becomes tagalong.1.log (replacing the
 * old one) before the next line. A failed write is swallowed: logging never breaks the app.
 */
export function installLogFile({
  dir,
  console: target = console,
  now = () => new Date(),
}: {
  dir: string;
  console?: Pick<Console, Level>;
  now?: () => Date;
}): void {
  const file = join(dir, 'tagalong.log');
  const write = (level: Level, args: readonly unknown[]): void => {
    try {
      const line = logLine(level, args, now());
      mkdirSync(dir, { recursive: true });
      try {
        if (statSync(file).size > MAX_FILE) renameSync(file, join(dir, 'tagalong.1.log'));
      } catch {
        // No file yet: nothing to rotate.
      }
      appendFileSync(file, `${line}\n`);
    } catch {
      // The disk said no, or the line could not be built; the console still has it.
    }
  };
  for (const level of ['warn', 'error'] as const) {
    const original = target[level].bind(target);
    target[level] = (...args: unknown[]) => {
      original(...args);
      write(level, args);
    };
  }
}

/**
 * A window's console message (Electron's 'console-message'): its warnings and errors go to
 * main's console, and so to the log file. Chromium hands over the message already formatted,
 * so the review rule (no speech, screen or file text in a warning) is what keeps it clean;
 * secrets are hidden and the line is cut at 300 characters as for main's own.
 */
export function rendererConsole(
  details: { level: string; message: string },
  target: Pick<Console, Level> = console,
): void {
  if (details.level === 'warning') target.warn(`[renderer] ${details.message}`);
  else if (details.level === 'error') target.error(`[renderer] ${details.message}`);
}

/** Open logs folder: makes the folder first (nothing may be logged yet), then opens it. */
export async function openLogsFolder(
  dir: string,
  open: (path: string) => Promise<string>,
): Promise<void> {
  mkdirSync(dir, { recursive: true });
  await open(dir);
}
