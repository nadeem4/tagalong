/**
 * Scout on the dock: a live 3D mascot (@tagalong/mascot) in a mood, with a small tag for what it
 * is doing (Seeing, Working), the sight-paused and listening marks, and the status tag.
 * Contains DockPet, DockMood and DOCK_MOODS. Used by the desktop avatar window.
 */

import { STATUS_WORDS } from './shapes';
import type { Pet, StatusMark as StatusMarkValue } from './shapes';
import { StatusMark } from './status-mark';
import { ScoutFace } from './scout-face';
import { scout } from './mascot/scout';
import { themeTokens as t } from './theme/tokens';

/**
 * What the pet on the dock is doing, as its pose and tag show it. `listening` is "Seeing"
 * (a capture); `reading` a screen tool in flight, `thinking` Scout's own turn, `speaking` its
 * voice playing and `working` one of its own background jobs. `dozing` is a pose with no tag.
 * The last four are short reactions: a job done (`celebrating`), a failure (`error`), Scout
 * speaking up on its own (`surprised`), something stopped (`sad`) and a click (`happy`).
 */
export const DOCK_MOODS = [
  'idle',
  'listening',
  'reading',
  'thinking',
  'speaking',
  'working',
  'dozing',
  'celebrating',
  'error',
  'surprised',
  'sad',
  'happy',
] as const;
export type DockMood = (typeof DOCK_MOODS)[number];

export interface DockPetProps {
  pet: Pet;
  mood: DockMood;
  /** The person turned sight off: a mark that stays until they turn it back on. */
  sightPaused?: boolean;
  /**
   * Always listening is on, or paused for a call or full screen: shown the whole time. While
   * on, `hearing` (speech heard, a quick pulse, no words read) and `follow-up` (a ring: one
   * reply needs no name) brighten the same dot.
   */
  listening?: ListeningDot | undefined;
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

/** The avatar window is 96 px square, and so is the mascot's frame. */
const SIZE = 96;

/**
 * The moods with a tag: Working covers a job's long back-office state. Thinking and reading
 * last seconds, their signs (the cloud, the glasses) say it and the bubble is already
 * answering, so they go without; so does dozing, in the pose alone.
 */
type TaggedMood = 'listening' | 'working';

const TAGS: Readonly<Record<TaggedMood, { text: string; color: string }>> = {
  listening: { text: 'Seeing', color: t.color.sky },
  working: { text: 'Working', color: t.color.gold },
};

const WORDS: Readonly<Record<DockMood, string>> = {
  idle: 'is idle',
  listening: 'is looking at your screen',
  reading: 'is reading your screen',
  thinking: 'is thinking',
  speaking: 'is speaking',
  working: 'is working on a job of its own',
  dozing: 'is dozing',
  celebrating: 'finished a job',
  error: 'hit a problem',
  surprised: 'has something to say',
  sad: 'stopped',
  happy: 'is happy to see you',
};

function isTagged(mood: DockMood): mood is TaggedMood {
  return mood in TAGS;
}

/**
 * The companion on the dock: the live mascot in a mood and a small tag for what it is doing
 * (seeing, working), plus the sight-paused and listening marks, which show in every mood.
 * The mascot's props (a laptop, a lightbulb) say the rest; it blinks and breathes on its own.
 */
export function DockPet({ pet, mood, sightPaused = false, listening, status }: DockPetProps) {
  // The Paused mark takes the top while sight is off: the two would overlap in 96 px, and the
  // pose and the label still say what Scout is doing.
  // `listening` is also the mood while speech is heard on the mic (Always listening): that is
  // hearing, not Seeing, so it takes no Seeing tag and says it only once.
  const hearing = mood === 'listening' && listening === 'hearing';
  const tag = isTagged(mood) && !sightPaused && !hearing ? TAGS[mood] : undefined;
  const label = `${pet.name} ${hearing ? 'is listening' : WORDS[mood]}${sightPaused ? ', sight paused' : ''}${
    listening === undefined || hearing ? '' : `, ${LISTENING[listening].words}`
  }${status == null ? '' : `, ${STATUS_WORDS[status.id].detail}`}`;
  return (
    <span
      role="img"
      aria-label={label}
      data-mood={mood}
      style={{ position: 'relative', display: 'block', width: SIZE, height: SIZE, padding: 0 }}
    >
      <style>{DOCK_CSS}</style>
      <ScoutFace spec={scout} mood={mood} />

      {tag !== undefined && (
        <span
          data-testid="dock-tag"
          style={{
            position: 'absolute',
            top: 4,
            right: 0,
            // Small and tucked into the corner, so it stays clear of the mascot's props.
            padding: `${t.space.xxs}px ${t.space.hair}px`,
            borderRadius: 999,
            background: tag.color,
            color: t.color.goldInk,
            fontFamily: t.font.ui,
            fontSize: t.dockTag,
            lineHeight: `${t.dockTag + 2}px`,
            fontWeight: t.fontWeight.semibold,
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
            background: t.color.dim,
            color: t.color.text,
            fontSize: t.type.caption.size,
            lineHeight: `${t.type.caption.line}px`,
            fontWeight: t.fontWeight.semibold,
          }}
        >
          Paused
        </span>
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

const DOCK_CSS = `
/* Always listening: a solid dot while on, an outline while paused. Never hidden. */
.dock-pet__listening { position: absolute; bottom: 8px; right: 16px; width: 8px; height: 8px; border-radius: 50%; box-sizing: border-box; border: 2px solid ${t.color.listening}; background: ${t.color.listening}; box-shadow: 0 0 0 1px ${t.color.card}; }
.dock-pet__listening[data-state='on'] { animation: dock-listening 2.4s ease-in-out infinite; }
.dock-pet__listening[data-state='paused'] { background: transparent; }
.dock-pet__listening[data-state='hearing'] { background: ${t.color.hearing}; border-color: ${t.color.hearing}; animation: dock-hearing 0.6s ease-out infinite; }
.dock-pet__listening[data-state='follow-up'] { box-shadow: 0 0 0 1px ${t.color.card}, 0 0 0 3px ${t.color.listening}; }
@keyframes dock-hearing { 0% { transform: scale(1); } 50% { transform: scale(1.35); } 100% { transform: scale(1); } }
@keyframes dock-listening { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
@media (prefers-reduced-motion: reduce) { .dock-pet__listening { animation: none !important; } }
`;
