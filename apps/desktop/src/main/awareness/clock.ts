/**
 * Time as an injectable Clock, so rolling memory and the pointer run under a fake clock in tests.
 * Contains Clock and systemClock.
 */

export interface Clock {
  now(): number;
  setTimeout(run: () => void, ms: number): unknown;
  setInterval(run: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  clearInterval(handle: unknown): void;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (run, ms) => setTimeout(run, ms),
  setInterval: (run, ms) => setInterval(run, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};
