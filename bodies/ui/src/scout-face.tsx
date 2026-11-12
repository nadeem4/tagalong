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

const FADE_MS = 200;

// Without WebGL2 (a VM, RDP, a blocklisted GPU) the engine throws on mount, which would unmount
// the avatar window and leave no dock. Draw the still head instead.
export function ScoutFace({ spec, mood, size = 96 }: ScoutFaceProps) {
  // Which spec has drawn its first frame, and which has finished fading in: a new spec builds a new
  // engine, so both start over with it.
  const [readySpec, setReadySpec] = useState<CharacterSpec | null>(null);
  const [fadedSpec, setFadedSpec] = useState<CharacterSpec | null>(null);
  const ready = readySpec === spec;
  const faded = fadedSpec === spec;
  const live = isSupported();
  // The shader builds lazily and can take seconds on a slow GPU, so the canvas stays blank until
  // then. Start the build once mounted (not during render), and show the still head until the
  // first live frame exists, so the dock is never empty.
  useEffect(() => {
    if (live) warm(spec, { floor: 0 });
  }, [live, spec]);
  // The still head stays under the canvas until its fade-in ends, so the swap never shows a gap.
  useEffect(() => {
    if (!ready) return;
    const id = setTimeout(() => setFadedSpec(spec), FADE_MS);
    return () => clearTimeout(id);
  }, [ready, spec]);
  const still = (
    <span
      style={{
        position: 'absolute',
        inset: 0,
        display: 'grid',
        placeItems: 'center',
        pointerEvents: 'none',
      }}
    >
      <ScoutGlyph size={Math.round(size * 0.7)} />
    </span>
  );
  if (!live)
    return (
      <span style={{ position: 'relative', display: 'block', width: size, height: size }}>
        {still}
      </span>
    );
  return (
    <span
      data-testid="scout-face"
      data-live={ready ? 'ready' : undefined}
      style={{ position: 'relative', display: 'block', width: size, height: size }}
    >
      {!faded && still}
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
        // Idle and dozing only breathe and blink, so they draw at 4 fps; hops and changes go back to 30.
        calmFps={4}
        onReady={() => setReadySpec(spec)}
        style={{
          position: 'absolute',
          inset: 0,
          width: size,
          height: size,
          opacity: ready ? 1 : 0,
          transition: `opacity ${FADE_MS}ms`,
        }}
      />
    </span>
  );
}
