/**
 * The last line a command printed, which is where the `tagalong` CLI puts its reason for failing.
 * Empty when it printed nothing.
 */
export const lastLine = (out: string): string => out.trim().split('\n').at(-1) ?? '';
