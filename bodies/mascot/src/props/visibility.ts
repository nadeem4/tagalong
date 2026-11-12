/* Which mood-gated parts show in a mood, and the spring that scales them in
   and out. Pure, so it is tested without a GPU; the Mascot just calls it
   each frame. New in the Tagalong fork (not in wobnimo). */

/** 1 for each gated part that lists the mood, else 0. */
export function gatedTargets(gated: string[][], mood: string): number[] {
  return gated.map((moods) => (moods.includes(mood) ? 1 : 0));
}

/** Scales for a fresh mascot, already settled in its mood so nothing grows in on load. */
export function initialScales(gated: string[][], mood: string): Float32Array<ArrayBuffer> {
  return new Float32Array(gatedTargets(gated, mood));
}

/* a slightly underdamped spring: props grow with a small overshoot and shrink without popping */
const STIFFNESS = 190;
const DAMPING = 17;
const MAX_STEP = 0.016;

/**
 * Moves each scale toward its target. `dt` of 0 jumps straight there (reduced
 * motion). Substeps keep the spring stable on a long frame. A part shrinking
 * to nothing snaps to exactly 0 once it is invisibly small, so it never
 * undershoots below zero.
 */
export function stepPartScales(
  scale: Float32Array,
  vel: Float32Array,
  targets: number[],
  dt: number,
): void {
  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    if (dt === 0) {
      scale[i] = target;
      vel[i] = 0;
      continue;
    }
    const n = Math.ceil(dt / MAX_STEP);
    const h = dt / n;
    for (let s = 0; s < n; s++) {
      vel[i] += ((target - scale[i]) * STIFFNESS - vel[i] * DAMPING) * h;
      scale[i] += vel[i] * h;
      if (target === 0 && scale[i] < 0.005) {
        scale[i] = 0;
        vel[i] = 0;
      }
    }
  }
}
