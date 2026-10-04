import type { Clock } from './clock';

interface Timer {
  id: number;
  due: number;
  every: number | null;
  run: () => void;
}

/**
 * A clock tests drive by hand. `advance` runs every timer that falls due, in order, and
 * lets the promises each one starts settle before moving on — a tick that awaits a capture
 * must finish before the next one fires, as it would in real time.
 */
export class FakeClock implements Clock {
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
    const timer = { id: this.#nextId++, due: this.#now + ms, every: null, run };
    this.#timers.push(timer);
    return timer.id;
  }

  setInterval(run: () => void, ms: number): unknown {
    const timer = { id: this.#nextId++, due: this.#now + ms, every: ms, run };
    this.#timers.push(timer);
    return timer.id;
  }

  clearTimeout(handle: unknown): void {
    this.#timers = this.#timers.filter((timer) => timer.id !== handle);
  }

  clearInterval(handle: unknown): void {
    this.clearTimeout(handle);
  }

  async advance(ms: number): Promise<void> {
    const until = this.#now + ms;
    for (;;) {
      const next = this.#timers
        .filter((timer) => timer.due <= until)
        .sort((a, b) => a.due - b.due || a.id - b.id)[0];
      if (next === undefined) break;
      this.#now = next.due;
      if (next.every === null) this.clearTimeout(next.id);
      else next.due += next.every;
      next.run();
      await flush();
    }
    this.#now = until;
    await flush();
  }
}

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}
