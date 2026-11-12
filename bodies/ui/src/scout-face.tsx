/**
 * ScoutFace: Scout drawn live by the mascot engine (@tagalong/mascot) in the given dock mood.
 * The mood goes through mascot/mood-states.ts, the one place that names engine moods.
 * Contains ScoutFace. Used by DockPet.
 */
import { useState } from 'react';
import { Mascot } from '@tagalong/mascot/react';
import { warm, type CharacterSpec } from '@tagalong/mascot';
import type { DockMood } from './dock-pet';
import { MOOD_STATE } from './mascot/mood-states';

export interface ScoutFaceProps {
  spec: CharacterSpec;
  mood: DockMood;
  size?: number;
}

// The shader builds lazily on the first draw, so the canvas is blank until it is ready. Start the
// build as soon as a spec is first seen (before mount) and fade the canvas in once a frame exists.
const warmed = new WeakSet<CharacterSpec>();

export function ScoutFace({ spec, mood, size = 96 }: ScoutFaceProps) {
  const [ready, setReady] = useState(false);
  if (!warmed.has(spec)) {
    warmed.add(spec);
    warm(spec);
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
      onReady={() => setReady(true)}
      style={{ width: size, height: size, opacity: ready ? 1 : 0, transition: 'opacity 200ms' }}
    />
  );
}
