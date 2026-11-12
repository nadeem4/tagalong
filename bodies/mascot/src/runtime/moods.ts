/* Custom moods: a spec names its own moods, each inheriting a built-in
   expression and optionally overriding bits of its face. These pure helpers
   say what a mood plays. New in the Tagalong fork (not in wobnimo). */

import { STATES, type FaceTargets, type MascotState } from '../behavior/states';
import type { CharacterSpec } from '../spec/types';

/** The built-in state a mood plays: a custom mood's `base`, else the state of that name. */
export function moodExpression(spec: CharacterSpec, mood: string): MascotState {
  const base = spec.moods?.[mood]?.base ?? mood;
  if (!STATES.includes(base as MascotState)) {
    throw new Error(
      `Unknown state "${mood}". Expected one of ${STATES.join(', ')}, or a name in the spec's moods.`,
    );
  }
  return base as MascotState;
}

/** The face targets a custom mood overrides, if any. */
export function moodFace(spec: CharacterSpec, mood: string): Partial<FaceTargets> | undefined {
  return spec.moods?.[mood]?.face;
}
