/* A frame pacer for a mascot that does not need the display's full rate (a small, always-on
   dock pet). `pace(dt)` returns the time to step this frame, or 0 to skip it; skipped time is
   carried to the next frame drawn, so motion keeps its speed. maxFps 0 means no cap. */

export function createPacer(maxFps: number): (dt: number) => number {
  if (maxFps <= 0) return (dt) => dt;
  const every = 1 / maxFps;
  /* start owing a full frame so the first one draws at once */
  let owed = every;
  return (dt) => {
    owed += dt;
    /* a little slack, so a 60 Hz display lands on 30 fps rather than drifting to 20 */
    if (owed < every - 0.004) return 0;
    const step = owed;
    owed = 0;
    return step;
  };
}
