/**
 * WhatsApp allows free text only for 24 hours after the person's last message. The clock is
 * injected so tests can move it.
 */

const WINDOW_MS = 24 * 60 * 60 * 1000;

export class Window {
  private last: number | null = null;

  constructor(private readonly now: () => number) {}

  touch(): void {
    this.last = this.now();
  }

  isOpen(): boolean {
    return this.last !== null && this.now() - this.last < WINDOW_MS;
  }
}
