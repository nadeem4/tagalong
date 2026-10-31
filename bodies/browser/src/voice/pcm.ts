/**
 * Float mic samples to the int16 the brain expects. The offscreen page opens its audio context
 * at 16 kHz, so Chrome has already resampled and only the scaling is left here.
 */
export function toPcm16(frame: Float32Array): Int16Array {
  const out = new Int16Array(frame.length);
  frame.forEach((sample, i) => {
    const clamped = Math.max(-1, Math.min(1, sample));
    out[i] = Math.round(clamped < 0 ? clamped * 32768 : clamped * 32767);
  });
  return out;
}
