/**
 * Whether the user has turned sight off, and who needs to know when that changes.
 *
 * One object rather than a flag passed around, because three things read it and two write
 * it: the platform gate refuses reads, the avatar greys its eye, the tray shows a
 * checkmark, and both the hotkey and that tray item toggle it. A boolean threaded through
 * all five is how the tray ends up disagreeing with reality.
 *
 * Deliberately not persisted. Pause is a moment — a call starting, someone at the desk —
 * and an app that boots blind because of a keypress last Tuesday reads as broken rather
 * than private. The exclusion list is the setting that survives restarts.
 */
export class SightPause {
  #paused = false;
  readonly #listeners = new Set<(paused: boolean) => void>();

  get paused(): boolean {
    return this.#paused;
  }

  /** Flips the state and returns what it became, so a caller can act without re-reading. */
  toggle(): boolean {
    this.set(!this.#paused);
    return this.#paused;
  }

  /** Moves to a state. A set that changes nothing tells nobody. */
  set(paused: boolean): void {
    if (paused === this.#paused) return;
    this.#paused = paused;
    for (const listener of [...this.#listeners]) {
      try {
        listener(paused);
      } catch (error) {
        // A renderer destroyed between the toggle and the send throws here. Letting that
        // escape would leave the remaining listeners — the tray among them — showing the
        // opposite of the truth.
        console.warn('[sight-pause] a listener failed:', error);
      }
    }
  }

  /** Subscribes, and returns the unsubscribe. */
  onChange(listener: (paused: boolean) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}
