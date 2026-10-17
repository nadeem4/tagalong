/** Tests for the Bean strips the avatar window ships, and the figure built from them. */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { DockMood } from '@tagalong/ui';
import manifest from './bean/manifest.json';
import { beanFigure } from './bean-figure';

const BEAN = join(fileURLToPath(new URL('.', import.meta.url)), 'bean');

const MOODS: readonly DockMood[] = [
  'idle',
  'listening',
  'reading',
  'thinking',
  'expert',
  'working',
  'done',
  'dozing',
  'wince',
  'cheer',
  'tired',
];
const NEEDED = [...MOODS, 'idle-blink', 'listening-blink'];

/** The URLs Vite would hand back for every strip in the folder. */
const urls = Object.fromEntries(
  Object.values(manifest.clips).map((c) => [`./bean/${c.file}`, `/assets/${c.file}`]),
);

describe('the Bean strips', () => {
  it.each(NEEDED)('has a clip for %s, with its strip on disk', (name) => {
    const clip = (manifest.clips as Record<string, { file: string; frames: number }>)[name];
    expect(clip).toBeDefined();
    expect(clip!.file).toMatch(/\.webp$/);
    expect(clip!.frames).toBeGreaterThan(0);
    expect(existsSync(join(BEAN, clip!.file))).toBe(true);
  });

  it('plays cheer, wince and the blinks once, and loops the rest', () => {
    const clips = manifest.clips as Record<string, { loop: boolean }>;
    for (const name of ['cheer', 'wince', 'idle-blink', 'listening-blink']) {
      expect(clips[name]!.loop).toBe(false);
    }
    for (const name of MOODS.filter((m) => m !== 'cheer' && m !== 'wince')) {
      expect(clips[name]!.loop).toBe(true);
    }
  });
});

describe('beanFigure', () => {
  it('gives every clip its bundled URL and the manifest timings', () => {
    const figure = beanFigure(manifest, urls);
    expect(figure.idle).toEqual({
      src: '/assets/idle.webp',
      frames: manifest.clips.idle.frames,
      fps: manifest.fps,
      loop: true,
    });
    expect(figure['listening-blink'].src).toBe('/assets/listening-blink.webp');
    for (const name of NEEDED) expect(figure[name as keyof typeof figure]).toBeDefined();
  });

  it('refuses a manifest with a clip missing', () => {
    const { tired: _tired, ...rest } = manifest.clips;
    expect(() => beanFigure({ ...manifest, clips: rest }, urls)).toThrow(/tired/);
  });

  it('refuses a clip whose strip was not bundled', () => {
    const { './bean/done.webp': _done, ...rest } = urls;
    expect(() => beanFigure(manifest, rest)).toThrow(/done\.webp/);
  });
});
