/**
 * The log file: main's warnings and errors, kept on disk so a person can send them when
 * something goes wrong. Contains logLine and installLogFile. The engine runs in main's
 * process, so core's warnings land here too.
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

const MAX_LINE = 300;
const MAX_FILE = 1024 * 1024;

type Level = 'warn' | 'error';

const errorText = (error: Error) => `${error.name}: ${error.message}`;

function part(value: unknown, first: boolean): string {
  if (value instanceof Error) return errorText(value);
  if (first && typeof value === 'string') return value;
  return value !== null && typeof value === 'object' ? '[object]' : `[${typeof value}]`;
}

/** One log line: time, level, the kept text, secrets hidden, on one line, at most 300 chars. */
export function logLine(level: Level, args: readonly unknown[], now: Date): string {
  const text = args.map((arg, i) => part(arg, i === 0)).join(' ');
  const line = `${now.toISOString()} ${level.toUpperCase()} ${hideSecrets(text)}`;
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
  const write = (line: string): void => {
    try {
      mkdirSync(dir, { recursive: true });
      try {
        if (statSync(file).size > MAX_FILE) renameSync(file, join(dir, 'tagalong.1.log'));
      } catch {
        // No file yet: nothing to rotate.
      }
      appendFileSync(file, `${line}\n`);
    } catch {
      // The disk said no; the console still has it.
    }
  };
  for (const level of ['warn', 'error'] as const) {
    const original = target[level].bind(target);
    target[level] = (...args: unknown[]) => {
      original(...args);
      write(logLine(level, args, now()));
    };
  }
}
