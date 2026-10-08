import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Pet } from '@tagalong/protocol';
import type { Job } from '../office/job';
import { PixelSprite } from '../office/pixel-sprite';
import { CURSOR, characterFor } from '../office/sprites/characters';
import type { Sprite } from '../office/sprites/sprite';
import { readStill } from '../office/still';
import { officeTokens as t } from '../office/tokens';
import {
  ALWAYS_EYE,
  LOOKING_EYE,
  PAUSED_EYE,
  RECORDING_DOT,
  WATCHING_GLASS,
  WATCH_ALERT,
  WORKING_BUBBLE,
} from './badges';

/** Long enough to be noticed, short enough not to be ignored as decoration. */
const CAPTURE_BADGE_MS = 1000;

/** The pet on the desktop is drawn like a party sprite; its marks like small tiles. */
const PET_SCALE = t.spriteScale.party;
const MARK_SCALE = t.spriteScale.tile;
/** Helpers are tiny: the same sprite at 1x beside the companion. */
const HELPER_SCALE = 1;
/** How many helper badges fit down the left edge of the window. */
const MAX_HELPERS = 3;

/** The stage is the whole window: one pet, its plate and its badges. */
export const COMPANION_SIZE = 96;

/**
 * The rules inline styles cannot express: the drag regions, the focus ring, the stepped
 * bob and hop, and stillness under reduced motion.
 */
export const COMPANION_CSS = `
.companion { position: relative; width: ${COMPANION_SIZE}px; height: ${COMPANION_SIZE}px; -webkit-app-region: drag; user-select: none; }
.companion__pet, .companion__badge { -webkit-app-region: no-drag; }
.companion__pet:focus-visible { outline: ${t.size.focusRing}px solid ${t.color.gold}; outline-offset: ${t.size.focusOffset}px; }
.companion-bob { animation: companion-bob ${t.timing.bob} steps(1) infinite; }
@keyframes companion-bob { 0% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
.companion-hop { animation: companion-hop ${t.timing.hop} steps(1) infinite; }
@keyframes companion-hop { 0% { transform: translateY(0); } 50% { transform: translateY(3px); } }
@media (prefers-reduced-motion: reduce) { .companion-bob, .companion-hop { animation: none; } }
`;

export interface DesktopCompanionProps {
  pet: Pet;
  /** The pet's role as the office shows it: the plate is underlined in its class ink. */
  job: Job;
  /** A turn is in flight: the pet bobs and shows a speech bubble. */
  working?: boolean;
  /**
   * How many looks have happened. A counter rather than a timestamp: two captures in the
   * same millisecond must still each show the badge, because a look is never silent.
   */
  captureCount?: number;
  /** The user turned sight off. A state that stays, unlike the capture badge. */
  sightPaused?: boolean;
  /** The sight permission is Always: a calm open eye stays while it is. */
  sightAlways?: boolean;
  /** Rolling memory is holding the last minutes of the screen. */
  recording?: boolean;
  /** A watch is running. */
  watching?: boolean;
  /** A watch fired and the user has not looked yet. */
  alert?: boolean;
  /** Something is waiting on the user: the gold marker. */
  needsYou?: boolean;
  /** Pets helping on the turn in flight. */
  helpers?: readonly Pet[];
  onSelect?: () => void;
}

/** "Ink", "Ink and Bolt", "Ink, Bolt and Sage". */
function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

function at(left: number, top: number): CSSProperties {
  return { position: 'absolute', left, top };
}

/** One small mark beside the pet: a sprite with its meaning in the tooltip. */
function Badge({
  testId,
  title,
  sprite,
  style,
  className,
}: {
  testId: string;
  title: string;
  sprite: Sprite;
  style: CSSProperties;
  className?: string | undefined;
}) {
  return (
    <span
      data-testid={testId}
      title={title}
      className={className === undefined ? 'companion__badge' : `companion__badge ${className}`}
      style={style}
    >
      <PixelSprite sprite={sprite} scale={MARK_SCALE} />
    </span>
  );
}

/**
 * The desktop companion: one pixel pet docked beside the user's work, with every state it
 * is in drawn as its own mark and named in words, never told by colour alone.
 *
 * The stage is the drag handle; the pet and its plate are one no-drag button that opens the
 * chat on it. Motion is stepped, and stops for reduced motion and the Still office setting.
 */
export function DesktopCompanion({
  pet,
  job,
  working = false,
  captureCount = 0,
  sightPaused = false,
  sightAlways = false,
  recording = false,
  watching = false,
  alert = false,
  needsYou = false,
  helpers = [],
  onSelect,
}: DesktopCompanionProps) {
  const [still] = useState(readStill);
  // Which capture the badge has already been shown for: derived visibility, so a re-render
  // can never lose or duplicate the badge.
  const [faded, setFaded] = useState(0);
  // Nothing is read while paused, so nothing may claim it was.
  const captured = !sightPaused && captureCount > faded;

  useEffect(() => {
    if (!captured) return;
    const timer = setTimeout(() => setFaded(captureCount), CAPTURE_BADGE_MS);
    return () => clearTimeout(timer);
  }, [captured, captureCount]);

  const showing = helpers.slice(0, MAX_HELPERS);
  const label = [
    `${pet.name} is ${working ? 'working' : 'at rest'}`,
    ...(sightPaused ? ['sight paused'] : sightAlways ? ['sight always on'] : []),
    ...(captured ? ['looked at your screen'] : []),
    ...(recording && !sightPaused ? ['recording the screen'] : []),
    ...(alert ? ['something happened'] : watching ? ['watching'] : []),
    ...(needsYou ? ['needs you'] : []),
    ...(helpers.length > 0 ? [`${listNames(helpers.map((h) => h.name))} helping`] : []),
  ].join(', ');

  return (
    <div className="companion">
      <style>{COMPANION_CSS}</style>
      <button
        type="button"
        className="companion__pet"
        aria-label={`Chat with ${pet.name}`}
        title={`${pet.name} · ${pet.model}. Click to chat`}
        onClick={onSelect}
        style={{
          ...at(20, 14),
          width: 56,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: t.space.xxs,
          padding: 0,
          border: 0,
          background: 'transparent',
          cursor: 'pointer',
        }}
      >
        <span
          role="img"
          aria-label={label}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: t.space.xxs,
          }}
        >
          <span
            className={working && !still ? 'companion-bob' : undefined}
            style={{ display: 'block' }}
          >
            <span
              data-testid="companion-sprite"
              style={{ display: 'block', width: 16 * PET_SCALE, height: 16 * PET_SCALE }}
            >
              <PixelSprite sprite={characterFor(pet).sprite} scale={PET_SCALE} />
            </span>
          </span>
          <span
            data-testid="companion-plate"
            data-ink={job.ink}
            style={{
              maxWidth: COMPANION_SIZE - t.space.xs,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              padding: `0 ${t.space.sm}px`,
              background: t.color.sidebar,
              color: t.color.text,
              borderBottom: `2px solid ${job.ink}`,
              fontFamily: t.font.pixel,
              fontSize: t.fontSize.min,
              letterSpacing: t.letterSpacing.pixel,
              lineHeight: '14px',
              textTransform: 'uppercase',
            }}
          >
            {pet.name}
          </span>
        </span>
      </button>

      {needsYou && (
        <Badge
          testId="needs-you"
          title={`${pet.name} needs you`}
          sprite={CURSOR}
          className={still ? undefined : 'companion-hop'}
          style={at(41, 2)}
        />
      )}
      {working && (
        <Badge testId="working-mark" title="Working" sprite={WORKING_BUBBLE} style={at(66, 0)} />
      )}

      {sightPaused ? (
        <Badge
          testId="paused-eye"
          title="Sight is paused. Tagalong cannot see your screen"
          sprite={PAUSED_EYE}
          style={at(76, 22)}
        />
      ) : captured ? (
        <Badge
          testId="capture-badge"
          title="Looked at your screen"
          sprite={LOOKING_EYE}
          style={at(76, 22)}
        />
      ) : (
        sightAlways && (
          <Badge
            testId="always-eye"
            title="Sight is always on. Each question carries a look at the window you are in"
            sprite={ALWAYS_EYE}
            style={at(76, 24)}
          />
        )
      )}
      {recording && !sightPaused && (
        <Badge
          testId="recording-dot"
          title="Rolling memory is on. Tagalong keeps the last few minutes of your screen in memory"
          sprite={RECORDING_DOT}
          style={at(79, 40)}
        />
      )}
      {alert ? (
        <Badge
          testId="watch-alert"
          title="A watch fired. Open the chat to see what happened"
          sprite={WATCH_ALERT}
          style={at(80, 56)}
        />
      ) : (
        watching && (
          <Badge
            testId="watching-mark"
            title="Watching your screen for something"
            sprite={WATCHING_GLASS}
            style={at(78, 58)}
          />
        )
      )}

      {showing.map((helper, index) => (
        <span
          key={helper.id}
          data-testid="helper-badge"
          title={`${helper.name} is helping`}
          className="companion__badge"
          style={at(t.space.xs, 18 + index * 18)}
        >
          <span
            data-testid="helper-sprite"
            style={{ display: 'block', width: 16 * HELPER_SCALE, height: 16 * HELPER_SCALE }}
          >
            <PixelSprite sprite={characterFor(helper).sprite} scale={HELPER_SCALE} />
          </span>
        </span>
      ))}
    </div>
  );
}
