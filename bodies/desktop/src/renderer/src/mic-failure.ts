/**
 * Why the microphone failed to open, read from the browser's error name. Shared by the talk
 * rules and the mic.
 */

/**
 * A refused permission reads as denied; a microphone another app holds as busy; anything
 * else as no microphone.
 */
export function micFailure(error: unknown): 'denied' | 'busy' | 'no-mic' {
  const name =
    typeof error === 'object' && error !== null && 'name' in error
      ? String((error as { name: unknown }).name)
      : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotReadableError' || name === 'AbortError') return 'busy';
  return 'no-mic';
}
