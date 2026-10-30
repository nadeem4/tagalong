/**
 * An event main may send before React has subscribed: a fresh Home window is told its page on
 * `did-finish-load`, which can beat the page's first effects. The last value that arrived with
 * no one listening is kept and handed to the first listener.
 * Contains heldUntilHeard; used by the preload for Home's page.
 */
export function heldUntilHeard<T>(): {
  arrived: (value: T) => void;
  listen: (handler: (value: T) => void) => () => void;
} {
  const listeners = new Set<(value: T) => void>();
  let held: { value: T } | null = null;
  return {
    arrived: (value) => {
      if (listeners.size === 0) held = { value };
      for (const listener of listeners) listener(value);
    },
    listen: (handler) => {
      listeners.add(handler);
      if (held !== null) {
        const { value } = held;
        held = null;
        handler(value);
      }
      return () => void listeners.delete(handler);
    },
  };
}
