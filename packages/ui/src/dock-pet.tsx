/**
 * Scout on the dock: the pixel character with a face per mood, a small tag (Seeing,
 * Working, Done), blinking, and the sight-paused, recording and listening marks.
 * Contains DockPet. Used by the desktop avatar window.
 */

import { useEffect, useMemo, useState } from 'react';
import type { Pet } from '@tagalong/protocol';
import { PixelSprite } from './office/pixel-sprite';
import { SCOUT_SPRITE } from './office/sprites/characters';
import { withBlink, withMood, type DockMood } from './office/sprites/expressions';
import { officeTokens as t } from './office/tokens';

export interface DockPetProps {
  pet: Pet;
  mood: DockMood;
  /** The person turned sight off: a mark that stays until they turn it back on. */
  sightPaused?: boolean;
  /** Rolling memory holds the last minutes of the screen: never allowed to be invisible. */
  recording?: boolean;
  /** Always listening is on, or paused for a call or full screen: shown the whole time. */
  listening?: 'on' | 'paused' | undefined;
  /** How often it blinks. Left out, every three to six seconds, never in step. */
  blinkEveryMs?: number;
}

/** How long the eyes stay shut. */
const BLINK_MS = 140;

/** The body's motion per mood; all of it stops when the system asks for reduced motion. */
const MOTION: Readonly<Record<DockMood, string>> = {
  idle: 'breathe',
  listening: 'breathe',
  working: 'busy',
  done: 'hop',
  dozing: 'doze',
  wince: 'shake',
  cheer: 'cheer',
  tired: 'doze',
};

/** The moods with a tag; dozing, wince, cheer and tired react on the face alone. */
type TaggedMood = 'listening' | 'working' | 'done';

const TAGS: Readonly<Record<TaggedMood, { text: string; color: string }>> = {
  listening: { text: 'Seeing', color: '#7CB8F2' },
  working: { text: 'Working', color: t.color.gold },
  done: { text: 'Done', color: '#7DD87F' },
};

const WORDS: Readonly<Record<DockMood, string>> = {
  idle: 'is idle',
  listening: 'is looking at your screen',
  working: 'has an expert working',
  done: 'has an answer for you',
  dozing: 'is dozing',
  wince: 'winces',
  cheer: 'is cheering',
  tired: 'looks tired',
};

function isTagged(mood: DockMood): mood is TaggedMood {
  return mood in TAGS;
}

/**
 * The companion on the dock: its pixel character, with a face and a small tag for what it
 * is doing (seeing, working, done), a face alone for its moods (dozing, wince, cheer, tired), plus
 * the sight-paused, recording and listening marks, which show in every mood.
 */
export function DockPet({
  pet,
  mood,
  sightPaused = false,
  recording = false,
  listening,
  blinkEveryMs,
}: DockPetProps) {
  const [blinking, setBlinking] = useState(false);
  // Blinks in moods with open eyes; working looks down at the task, done and cheer squint,
  // dozing and wince have their eyes shut, tired half shut. A blink is motion too, so it
  // stops with the rest when the system asks for less.
  const [still] = useState(reducedMotion);
  const canBlink = !still && (mood === 'idle' || mood === 'listening');

  useEffect(() => {
    if (!canBlink) return;
    let open: ReturnType<typeof setTimeout> | undefined;
    let next: ReturnType<typeof setTimeout>;
    const schedule = (): void => {
      next = setTimeout(
        () => {
          setBlinking(true);
          open = setTimeout(() => {
            setBlinking(false);
            schedule();
          }, BLINK_MS);
        },
        blinkEveryMs ?? 3000 + Math.random() * 3000,
      );
    };
    schedule();
    return () => {
      clearTimeout(next);
      clearTimeout(open);
      setBlinking(false);
    };
  }, [canBlink, blinkEveryMs]);

  const sprite = useMemo(() => {
    const faced = withMood(SCOUT_SPRITE, mood);
    return blinking && canBlink ? withBlink(faced) : faced;
  }, [mood, blinking, canBlink]);
  const tag = isTagged(mood) ? TAGS[mood] : undefined;
  const label = `${pet.name} ${WORDS[mood]}${sightPaused ? ', sight paused' : ''}${
    recording && !sightPaused ? ', recording the screen' : ''
  }${listening === 'on' ? ', listening' : listening === 'paused' ? ', listening paused' : ''}`;
  return (
    <span
      role="img"
      aria-label={label}
      data-mood={mood}
      data-blink={String(blinking && canBlink)}
      style={{ position: 'relative', display: 'inline-flex', padding: '20px 4px 4px' }}
    >
      <style>{DOCK_CSS}</style>
      <span data-testid="dock-body" data-motion={MOTION[mood]} className="dock-body">
        <PixelSprite sprite={sprite} scale={4} />
      </span>
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
      {listening !== undefined && (
        <span
          className="dock-pet__listening"
          data-testid="listening-mark"
          data-state={listening}
          aria-hidden="true"
        />
      )}
    </span>
  );
}

/** Whether the person asked the system for less motion. */
function reducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

const DOCK_CSS = `
.dock-body { display: block; transform-origin: 50% 100%; }
.dock-body[data-motion='breathe'] { animation: dock-breathe 2.8s ease-in-out infinite; }
.dock-body[data-motion='busy'] { animation: dock-busy 0.9s ease-in-out infinite; }
.dock-body[data-motion='hop'] { animation: dock-hop 0.7s ease-out 3; }
.dock-body[data-motion='doze'] { animation: dock-breathe 5s ease-in-out infinite; }
.dock-body[data-motion='shake'] { animation: dock-shake 0.4s ease-in-out 1; }
.dock-body[data-motion='cheer'] { animation: dock-hop 0.7s ease-out 2; }
@keyframes dock-breathe { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-1px); } }
@keyframes dock-busy { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-2px); } }
@keyframes dock-hop { 0%, 100% { transform: translateY(0); } 40% { transform: translateY(-8px); } }
@keyframes dock-shake { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(-2px); } 75% { transform: translateX(2px); } }
/* Always listening: a solid dot while on, an outline while paused. Never hidden. */
.dock-pet__listening { position: absolute; bottom: 4px; right: 4px; width: 8px; height: 8px; border-radius: 50%; box-sizing: border-box; border: 2px solid #7DD87F; background: #7DD87F; box-shadow: 0 0 0 1px #fff; }
.dock-pet__listening[data-state='on'] { animation: dock-listening 2.4s ease-in-out infinite; }
.dock-pet__listening[data-state='paused'] { background: transparent; }
@keyframes dock-listening { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
@media (prefers-reduced-motion: reduce) { .dock-body, .dock-pet__listening { animation: none !important; } }
`;
