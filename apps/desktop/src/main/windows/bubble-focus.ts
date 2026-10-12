/**
 * Whether the bubble hides when it loses focus. It is easy to dismiss by clicking anywhere
 * else, but never by touching the pet it speaks from (a click or a drag on the pet focuses
 * the pet's window), and never while an answer is still streaming in.
 */
export function hidesOnBlur(state: {
  streaming: boolean;
  focusWentToPet: boolean;
  /** The blur is judged a moment later; by then the bubble may have been opened again. */
  focusedAgain: boolean;
}): boolean {
  return !state.streaming && !state.focusWentToPet && !state.focusedAgain;
}
