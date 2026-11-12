/* Frame pacing for a mascot that does not need the display's full rate (a small, always-on
   dock pet). `createPacer` turns a rate into "step this much, or skip"; `createRate` picks the
   rate: the cap while anything moves, a slow calm rate when the pet only breathes and blinks.
   Skipped time is carried to the next frame drawn, so motion keeps its speed. 0 means no cap. */

export function createPacer(maxFps: number): (dt: number, fps?: number) => number {
  /* start owing a full frame so the first one draws at once */
  let owed = -1;
  return (dt, fps = maxFps) => {
    if (fps <= 0) return dt;
    const every = 1 / fps;
    owed = (owed < 0 ? every : owed) + dt;
    /* a little slack, so a 60 Hz display lands on 30 fps rather than drifting to 20 */
    if (owed < every - 0.004) return 0;
    const step = owed;
    owed = 0;
    return step;
  };
}

/** How long the full rate holds after a change (a mood, a poke), so springs settle smoothly. */
const BOOST = 1.5;

export interface RateState {
  /** The mood only breathes and blinks (idle, sleeping). */
  calm: boolean;
  /** A hop or a blink is under way. */
  moving: boolean;
}

export function createRate(maxFps: number, calmFps: number) {
  let boost = BOOST;
  return {
    /** Something changed: draw at the full rate for a moment. */
    bump() {
      boost = BOOST;
    },
    /** The rate to draw at now, given the time since the last frame and what the pet is doing. */
    next(dt: number, { calm, moving }: RateState): number {
      boost = Math.max(0, boost - dt);
      return calm && !moving && boost === 0 && calmFps > 0 ? calmFps : maxFps;
    },
  };
}
