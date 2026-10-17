/**
 * Bean's figure for the dock, built from the strips in ./bean: the manifest gives each clip's
 * frames and whether it loops, and Vite gives each strip's bundled URL. Kept apart from
 * avatar.tsx so it is tested in plain Node. Contains beanFigure.
 */
import type { BeanFigure } from '@tagalong/ui';

/** manifest.json as pack.py writes it. */
export interface BeanManifest {
  fps: number;
  clips: Readonly<Record<string, { file: string; frames: number; loop: boolean }>>;
}

/** Every clip DockPet draws. */
const CLIPS: readonly (keyof BeanFigure)[] = [
  'idle',
  'listening',
  'working',
  'done',
  'dozing',
  'wince',
  'cheer',
  'tired',
  'idle-blink',
  'listening-blink',
];

/**
 * The figure from the manifest and the bundled URLs, keyed `./bean/<file>`. A clip missing
 * from either throws: a dock without a pose would draw nothing at all.
 */
export function beanFigure(
  manifest: BeanManifest,
  urls: Readonly<Record<string, string>>,
): BeanFigure {
  const entries = CLIPS.map((name) => {
    const clip = manifest.clips[name];
    if (clip === undefined) throw new Error(`Bean has no ${name} clip in manifest.json`);
    const src = urls[`./bean/${clip.file}`];
    if (src === undefined) throw new Error(`Bean's ${clip.file} was not bundled`);
    return [name, { src, frames: clip.frames, fps: manifest.fps, loop: clip.loop }] as const;
  });
  return Object.fromEntries(entries) as Record<keyof BeanFigure, BeanFigure[keyof BeanFigure]>;
}
