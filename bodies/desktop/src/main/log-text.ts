/** What a log line keeps of console arguments. Contains keptText. */

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
