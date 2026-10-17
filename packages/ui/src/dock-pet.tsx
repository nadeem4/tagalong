/**
 * Scout on the dock: Bean, the 3D figure, drawn from a pre-rendered clip per mood, with a small
 * tag (Seeing, Working, Done), blinking, the sight-paused, recording and listening marks, and
 * the status tag. Contains DockPet, DockMood and BeanFigure. Used by the desktop avatar window.
 */

import { useEffect, useRef, useState } from 'react';
import { STATUS_WORDS } from '@tagalong/protocol';
import type { Pet, StatusMark as StatusMarkValue } from '@tagalong/protocol';
import { StatusMark } from './status-mark';
import { BeanClip, type BeanClipData } from './theme/bean-clip';
import { themeTokens as t } from './theme/tokens';

/**
 * What the pet on the dock is doing, as its pose and tag show it. `listening` is "Seeing"
 * (a capture); dozing, wince, cheer and tired are moods with a pose and no tag.
 */
export type DockMood =
  'idle' | 'listening' | 'working' | 'done' | 'dozing' | 'wince' | 'cheer' | 'tired';

/** The moods Bean blinks in; each has a blink clip rendered from frame 0 of its loop. */
type BlinkMood = 'idle' | 'listening';

/** Every clip of Bean the dock draws: one per mood, plus a blink for each mood that blinks. */
export type BeanFigure = Readonly<Record<DockMood | `${BlinkMood}-blink`, BeanClipData>>;

export interface DockPetProps {
  pet: Pet;
  mood: DockMood;
  /** Bean's clips: the host bundles the strips and hands in their URLs and timings. */
  figure: BeanFigure;
  /** The person turned sight off: a mark that stays until they turn it back on. */
  sightPaused?: boolean;
  /** Rolling memory holds the last minutes of the screen: never allowed to be invisible. */
  recording?: boolean;
  /**
   * Always listening is on, or paused for a call or full screen: shown the whole time. While
   * on, `hearing` (speech heard, a quick pulse, no words read) and `follow-up` (a ring: one
   * reply needs no name) brighten the same dot.
   */
  listening?: ListeningDot | undefined;
  /** How often it blinks. Left out, every three to six seconds, never in step. */
  blinkEveryMs?: number;
  /** The top status mark (a problem, progress or a hint), as a tag at the bottom centre. */
  status?: StatusMarkValue | null;
}

export type ListeningDot = 'on' | 'paused' | 'hearing' | 'follow-up';

/** The listening dot's tooltip, and the words it adds to Scout's label. */
const LISTENING: Readonly<Record<ListeningDot, { title: string; words: string }>> = {
  on: { title: STATUS_WORDS['listening-on'].detail, words: 'listening' },
  hearing: { title: STATUS_WORDS['listening-on'].detail, words: 'listening' },
  'follow-up': {
    title: 'Listening for your reply, no name needed.',
    words: 'listening for your reply',
  },
  paused: { title: STATUS_WORDS['listening-paused'].detail, words: 'listening paused' },
};

/** The avatar window is 96 px square, and so is one frame of Bean. */
const SIZE = 96;

/** The moods with a tag; dozing, wince, cheer and tired react in the pose alone. */
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

function canBlinkIn(mood: DockMood): mood is BlinkMood {
  return mood === 'idle' || mood === 'listening';
}

/**
 * The companion on the dock: Bean in a pose and a small tag for what it is doing (seeing,
 * working, done), a pose alone for its moods (dozing, wince, cheer, tired), plus the
 * sight-paused, recording and listening marks, which show in every mood.
 */
export function DockPet({
  pet,
  mood,
  figure,
  sightPaused = false,
  recording = false,
  listening,
  blinkEveryMs,
  status,
}: DockPetProps) {
  const [blinking, setBlinking] = useState(false);
  // Blinks in idle and listening, the poses with open eyes and a blink clip of their own. A
  // blink is motion too, so it stops with the rest when the system asks for less.
  const [still] = useState(reducedMotion);
  const blinkMood = !still && canBlinkIn(mood) ? mood : undefined;
  // Time to blink. The blink then waits for the loop to come round to frame 0, the pose its
  // frames were rendered from, so nothing jumps.
  const due = useRef(false);
  const shut = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Bumped after each blink, to start the next wait.
  const [blinks, setBlinks] = useState(0);

  useEffect(() => {
    if (blinkMood === undefined) return;
    const wait = setTimeout(
      () => {
        due.current = true;
      },
      blinkEveryMs ?? 3000 + Math.random() * 3000,
    );
    return () => {
      clearTimeout(wait);
      clearTimeout(shut.current);
      due.current = false;
      setBlinking(false);
    };
  }, [blinkMood, blinkEveryMs, blinks]);

  const loopCameRound = (): void => {
    if (!due.current || blinkMood === undefined) return;
    due.current = false;
    setBlinking(true);
    const clip = figure[`${blinkMood}-blink`];
    shut.current = setTimeout(
      () => {
        setBlinking(false);
        setBlinks((n) => n + 1);
      },
      (clip.frames / clip.fps) * 1000,
    );
  };

  const showBlink = blinking && blinkMood !== undefined;
  // The Paused mark takes the top while sight is off: the two would overlap in 96 px, and the
  // pose (the gear, the check) and the label still say what Bean is doing.
  const tag = isTagged(mood) && !sightPaused ? TAGS[mood] : undefined;
  const label = `${pet.name} ${WORDS[mood]}${sightPaused ? ', sight paused' : ''}${
    recording && !sightPaused ? ', recording the screen' : ''
  }${listening === undefined ? '' : `, ${LISTENING[listening].words}`}${
    status == null ? '' : `, ${STATUS_WORDS[status.id].detail}`
  }`;
  return (
    <span
      role="img"
      aria-label={label}
      data-mood={mood}
      data-blink={String(showBlink)}
      style={{ position: 'relative', display: 'block', width: SIZE, height: SIZE, padding: 0 }}
    >
      <style>{DOCK_CSS}</style>
      {/* Keyed by mood, so a one-shot (cheer, wince) always plays from its first frame. */}
      <BeanClip
        key={mood}
        name={mood}
        clip={figure[mood]}
        still={still}
        // Hidden, not stopped, under a blink: the loop keeps time and carries on after it.
        {...(showBlink ? { style: { visibility: 'hidden' } } : {})}
        onAnimationIteration={loopCameRound}
      />
      {showBlink && (
        <BeanClip
          name={`${blinkMood}-blink`}
          clip={figure[`${blinkMood}-blink`]}
          style={{ position: 'absolute', top: 0, left: 0 }}
        />
      )}
      {tag !== undefined && (
        <span
          data-testid="dock-tag"
          style={{
            position: 'absolute',
            top: 4,
            right: 0,
            // Small and tucked into the corner, so it stays clear of Bean's floating sign (the
            // gear, the check) beside it.
            padding: '1px 3px',
            borderRadius: 999,
            background: tag.color,
            color: t.color.goldInk,
            fontFamily: t.font.ui,
            fontSize: 9,
            lineHeight: '11px',
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
            top: 4,
            left: 12,
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
            bottom: 8,
            left: 16,
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: '#E5484D',
            boxShadow: '0 0 0 1px #fff',
          }}
        />
      )}
      {status != null && <StatusMark mark={status} variant="tag" />}
      {listening !== undefined && (
        <span
          className="dock-pet__listening"
          data-testid="listening-mark"
          data-state={listening}
          title={LISTENING[listening].title}
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
/* Always listening: a solid dot while on, an outline while paused. Never hidden. */
.dock-pet__listening { position: absolute; bottom: 8px; right: 16px; width: 8px; height: 8px; border-radius: 50%; box-sizing: border-box; border: 2px solid #7DD87F; background: #7DD87F; box-shadow: 0 0 0 1px #fff; }
.dock-pet__listening[data-state='on'] { animation: dock-listening 2.4s ease-in-out infinite; }
.dock-pet__listening[data-state='paused'] { background: transparent; }
.dock-pet__listening[data-state='hearing'] { background: #B8F5B9; border-color: #B8F5B9; animation: dock-hearing 0.6s ease-out infinite; }
.dock-pet__listening[data-state='follow-up'] { box-shadow: 0 0 0 1px #fff, 0 0 0 3px #7DD87F; }
@keyframes dock-hearing { 0% { transform: scale(1); } 50% { transform: scale(1.35); } 100% { transform: scale(1); } }
@keyframes dock-listening { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
/* A backstop: the clips are already drawn still when the system asks for less motion. */
@media (prefers-reduced-motion: reduce) { [data-testid='bean-clip'], .dock-pet__listening { animation: none !important; } }
`;
