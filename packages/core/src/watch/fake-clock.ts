import type { WatchClock } from './watch-manager';

interface Timer {
  id: number;
  due: number;
  run: () => void;
}

/**
 * A clock tests move by hand. `advance` fires every timer that falls due, in order, and
 * lets the promises each one starts settle before the next, so a watch tick that awaits a
 * diff and a model check finishes before the following tick fires — as it would in time.
 */
export class FakeClock implements WatchClock {
  #now: number;
  #nextId = 1;
  #timers: Timer[] = [];

  constructor(start = 0) {
    this.#now = start;
  }

  now(): number {
    return this.#now;
  }

  get pendingTimers(): number {
    return this.#timers.length;
  }

  setTimeout(run: () => void, ms: number): unknown {
    const timer = { id: this.#nextId++, due: this.#now + ms, run };
    this.#timers.push(timer);
    return timer.id;
  }

  clearTimeout(handle: unknown): void {
    this.#timers = this.#timers.filter((timer) => timer.id !== handle);
  }

  async advance(ms: number): Promise<void> {
    const until = this.#now + ms;
    await settle();
    for (;;) {
      const next = this.#timers
        .filter((timer) => timer.due <= until)
        .sort((a, b) => a.due - b.due || a.id - b.id)[0];
      if (next === undefined) break;
      this.#now = next.due;
      this.clearTimeout(next.id);
      next.run();
      await settle();
    }
    this.#now = until;
    await settle();
  }
}

async function settle(): Promise<void> {
  for (let i = 0; i < 50; i += 1) await Promise.resolve();
}
