/**
 * ScoutFace: Scout drawn live by the mascot engine (@tagalong/mascot) in the given dock mood.
 * The mood goes through mascot/mood-states.ts, the one place that names engine moods.
 * Contains ScoutFace. Used by DockPet.
 */
import { useEffect, useState } from 'react';
import { Mascot } from '@tagalong/mascot/react';
import { isSupported, warm, type CharacterSpec } from '@tagalong/mascot';
import type { DockMood } from './dock-pet';
import { MOOD_STATE } from './mascot/mood-states';
import { ScoutGlyph } from './scout-mark';

export interface ScoutFaceProps {
  spec: CharacterSpec;
  mood: DockMood;
  size?: number;
}

// Without WebGL2 (a VM, RDP, a blocklisted GPU) the engine throws on mount, which would unmount
// the avatar window and leave no dock. Draw the still head instead.
export function ScoutFace({ spec, mood, size = 96 }: ScoutFaceProps) {
  const [ready, setReady] = useState(false);
  const live = isSupported();
  // The shader builds lazily on the first draw, so the canvas is blank until it is ready. Start
  // the build once mounted (not during render) and fade the canvas in once a frame exists.
  useEffect(() => {
    if (live) warm(spec);
  }, [live, spec]);
  if (!live) {
    return (
      <span style={{ display: 'grid', placeItems: 'center', width: size, height: size }}>
        <ScoutGlyph size={Math.round(size * 0.7)} />
      </span>
    );
  }
  return (
    <Mascot
      character={spec}
      state={MOOD_STATE[mood]}
      interactive={false}
      floor={0}
      framing={1.05}
      // 1 keeps the always-on dock cheap: the avatar is small and the window is not HiDPI-critical.
      maxPixelRatio={1}
      // The dock is always on screen: 30 fps is plenty for a 96px pet and halves its cost.
      maxFps={30}
      onReady={() => setReady(true)}
      style={{ width: size, height: size, opacity: ready ? 1 : 0, transition: 'opacity 200ms' }}
    />
  );
}
