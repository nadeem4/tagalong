/**
 * jsdom has no AnimationEvent. Without it React listens for the webkit-prefixed name, so a
 * test's `animationiteration` never reaches `onAnimationIteration`. Imported before React.
 */

if (typeof window !== 'undefined' && !('AnimationEvent' in window)) {
  class AnimationEvent extends Event {}
  Object.assign(window, { AnimationEvent });
}
