/**
 * Scout's mark: Bean standing still in a small rounded tile, drawn beside lines Scout starts
 * (the quiet line, a remark in the bubble, the first message in the chat). Decorative; the word
 * "Scout" next to it is the real text. Contains ScoutMark.
 */

import { BeanClip } from './theme/bean-clip';
import type { BeanClipData } from './theme/bean-clip';

interface ScoutMarkProps {
  /** Bean's idle strip, drawn still. Without it the tile is drawn empty. */
  clip?: BeanClipData;
  /** The tile's side in px. */
  size?: number;
}

/** Bean fills about two thirds of a frame, so the frame is drawn larger than the tile that crops it. */
const FRAME_RATIO = 1.36;

export function ScoutMark({ clip, size = 20 }: ScoutMarkProps) {
  const frame = Math.round(size * FRAME_RATIO);
  return (
    <span className="scout-mark" aria-hidden="true" style={{ width: size, height: size }}>
      {clip !== undefined && (
        <BeanClip
          clip={clip}
          still
          size={frame}
          name="mark"
          style={{ flex: 'none', transform: `translate(${size * 0.036}px, ${size * -0.107}px)` }}
        />
      )}
    </span>
  );
}
