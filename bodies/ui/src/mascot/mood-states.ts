/**
 * The one place Tagalong's dock moods meet the mascot engine's moods. Nothing else in the app
 * names an engine mood, so a different mascot only needs this file to change.
 */
import type { MascotMood } from '@tagalong/mascot';
import type { DockMood } from '../dock-pet';

/** `reading` and `happy` are Scout's own moods (see `moods` in scout.ts); dozing plays the engine's sleeping. */
export const MOOD_STATE: Readonly<Record<DockMood, MascotMood>> = {
  idle: 'idle',
  listening: 'listening',
  reading: 'reading',
  thinking: 'thinking',
  speaking: 'speaking',
  working: 'working',
  dozing: 'sleeping',
  celebrating: 'celebrating',
  error: 'error',
  surprised: 'surprised',
  sad: 'sad',
  happy: 'happy',
};
