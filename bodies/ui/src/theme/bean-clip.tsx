/**
 * One clip of Bean, the 3D Scout: a pre-rendered strip of frames side by side, shown one
 * frame at a time (96 px unless sized) and stepped through with CSS. Contains BeanClip and its
 * clip type.
 */

import type { AnimationEventHandler, CSSProperties } from 'react';

/** One strip: its URL, how many frames it holds, at what rate, and whether it loops. */
export interface BeanClipData {
  src: string;
  frames: number;
  fps: number;
  /** A loop runs forever; a one-shot (a blink) plays once and holds its last frame. */
  loop: boolean;
}

export interface BeanClipProps {
  clip: BeanClipData;
  /** Reduced motion: no stepping, frame 0 of a loop or the held last frame of a one-shot. */
  still?: boolean;
  /** Which clip this is, for `data-clip`. */
  name?: string;
  /** The frame's size on screen in px; the whole strip scales with it. */
  size?: number;
  style?: CSSProperties;
  /** Fires each time a loop comes back round to frame 0. */
  onAnimationIteration?: AnimationEventHandler<HTMLSpanElement>;
}

/** The dock's frame size on screen; the strips are rendered at twice this for HiDPI. */
const FRAME = 96;

/**
 * A strip of Bean frames as a CSS background. A loop runs `steps(n)` to one frame past the
 * last, forever, so each frame shows once per loop. A one-shot runs `steps(n-1)` to its last
 * frame with `forwards` and holds it: `steps(n)` would end past the strip and show nothing.
 * Either way each step lasts one frame time (1/fps), so a one-shot runs (n-1)/fps and its last
 * frame lands one frame time before n/fps: a two-frame blink shown for 2/fps shows both.
 */
export function BeanClip({
  clip,
  still = false,
  name,
  size = FRAME,
  style,
  onAnimationIteration,
}: BeanClipProps) {
  const { frames, fps, loop } = clip;
  const last = -(frames - 1) * size;
  const end = loop ? -frames * size : last;
  const steps = loop ? frames : frames - 1;
  const keyframes = `bean-to-${-end}`;
  const base: CSSProperties = {
    display: 'block',
    width: size,
    height: size,
    backgroundImage: `url("${clip.src}")`,
    backgroundRepeat: 'no-repeat',
    backgroundSize: `${frames * size}px ${size}px`,
  };
  const motion: CSSProperties = still
    ? { backgroundPosition: `${loop ? 0 : last}px 0px` }
    : {
        backgroundPosition: '0px 0px',
        animation: `${keyframes} ${steps / fps}s steps(${steps}) ${loop ? 'infinite' : 'forwards'}`,
      };
  return (
    <span
      data-testid="bean-clip"
      data-clip={name}
      aria-hidden="true"
      style={{ ...base, ...motion, ...style }}
      onAnimationIteration={onAnimationIteration}
    >
      {!still && (
        <style>{`@keyframes ${keyframes} { from { background-position: 0px 0px; } to { background-position: ${end}px 0px; } }`}</style>
      )}
    </span>
  );
}
