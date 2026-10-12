import { useMemo } from 'react';
import type { Pet } from '@tagalong/protocol';
import { PixelSprite } from './office/pixel-sprite';
import { characterFor } from './office/sprites/characters';
import { withMood, type DockMood } from './office/sprites/expressions';
import { officeTokens as t } from './office/tokens';

export interface DockPetProps {
  pet: Pet;
  mood: DockMood;
  /** The person turned sight off: a mark that stays until they turn it back on. */
  sightPaused?: boolean;
  /** Rolling memory holds the last minutes of the screen: never allowed to be invisible. */
  recording?: boolean;
}

const TAGS: Readonly<Record<Exclude<DockMood, 'idle'>, { text: string; color: string }>> = {
  listening: { text: 'Seeing', color: '#7CB8F2' },
  working: { text: 'Working', color: t.color.gold },
  done: { text: 'Done', color: '#7DD87F' },
};

const WORDS: Readonly<Record<DockMood, string>> = {
  idle: 'is idle',
  listening: 'is looking at your screen',
  working: 'has an expert working',
  done: 'has an answer for you',
};

/**
 * The companion on the dock: its pixel character, with a face and a small tag for what it
 * is doing (seeing, working, done), plus the sight-paused and recording marks.
 */
export function DockPet({ pet, mood, sightPaused = false, recording = false }: DockPetProps) {
  const sprite = useMemo(() => withMood(characterFor(pet).sprite, mood), [pet, mood]);
  const tag = mood === 'idle' ? undefined : TAGS[mood];
  const label = `${pet.name} ${WORDS[mood]}${sightPaused ? ', sight paused' : ''}${
    recording && !sightPaused ? ', recording the screen' : ''
  }`;
  return (
    <span
      role="img"
      aria-label={label}
      data-mood={mood}
      style={{ position: 'relative', display: 'inline-flex', padding: '20px 4px 4px' }}
    >
      <PixelSprite sprite={sprite} scale={4} />
      {tag !== undefined && (
        <span
          data-testid="dock-tag"
          style={{
            position: 'absolute',
            top: 0,
            right: -8,
            padding: '2px 7px',
            borderRadius: 999,
            background: tag.color,
            color: t.color.goldInk,
            fontFamily: t.font.ui,
            fontSize: 11,
            fontWeight: 600,
            whiteSpace: 'nowrap',
          }}
        >
          {tag.text}
        </span>
      )}
      {sightPaused && (
        <span
          data-testid="paused-eye"
          title="Sight is paused — Tagalong cannot see your screen"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            padding: '2px 6px',
            borderRadius: 999,
            background: '#6B7290',
            color: t.color.text,
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          Paused
        </span>
      )}
      {recording && !sightPaused && (
        <span
          data-testid="recording-dot"
          title="Rolling memory is on — Tagalong keeps the last few minutes of your screen in memory"
          style={{
            position: 'absolute',
            bottom: 4,
            left: 4,
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: '#E5484D',
            boxShadow: '0 0 0 1px #fff',
          }}
        />
      )}
    </span>
  );
}
