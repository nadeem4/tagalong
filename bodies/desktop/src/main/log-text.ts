/**
 * What a log line keeps of console arguments, and forwardConsole, which the voice process
 * uses to send its warnings to main's log file. Kept apart from log-file.ts so the voice
 * process's bundle needs neither core nor the disk. Contains keptText and forwardConsole.
 */

export type Level = 'warn' | 'error';

const errorText = (error: Error) => `${error.name}: ${error.message}`;

function part(value: unknown, first: boolean): string {
  if (value instanceof Error) return errorText(value);
  if (first && typeof value === 'string') return value;
  return value !== null && typeof value === 'object' ? '[object]' : `[${typeof value}]`;
}

/** A text first argument, an Error's name and message, and every other value as its type. */
export const keptText = (args: readonly unknown[]): string =>
  args.map((arg, i) => part(arg, i === 0)).join(' ');

/**
 * For the voice process, which has no log file: wraps console.warn and console.error (the
 * originals still run) so each call also posts its kept text, never its other arguments, to
 * main, which logs it. A failed post is swallowed.
 */
export function forwardConsole(
  post: (level: Level, text: string) => void,
  target: Pick<Console, Level> = console,
): void {
  for (const level of ['warn', 'error'] as const) {
    const original = target[level].bind(target);
    target[level] = (...args: unknown[]) => {
      original(...args);
      try {
        post(level, keptText(args));
      } catch {
        // Main has gone; the voice process's console still has it.
      }
    };
  }
}
