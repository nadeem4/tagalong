import { useEffect, useMemo, useState } from 'react';
import type { Pet } from '@tagalong/protocol';
import { useHostBridge } from '../host-bridge';
import { ROOM_COUNT } from './layout';
import type { OfficeMember } from './member';
import { MeetingsPanel } from './meetings-panel';
import { OFFICE_CSS } from './office-styles';
import { OfficeFloor } from './office-floor';
import { PartyList } from './party-list';
import { PixelSprite } from './pixel-sprite';
import { CHARACTERS, characterFor } from './sprites/characters';
import { NO_ACTIVITY, nextActivity, statusOf } from './status';
import { readStill, writeStill } from './still';
import { officeTokens as t } from './tokens';

const NOT_YET = 'Task assignment arrives in a later update';

/**
 * The Crew Office: the crew as pixel characters at their desks, a party list to pick one,
 * and the meeting rooms they will use later. Host-agnostic — it reads the crew and the
 * turn events through the HostBridge, like the chat panel.
 */
export function OfficeView() {
  const bridge = useHostBridge();
  const [pets, setPets] = useState<Pet[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [activity, setActivity] = useState(NO_ACTIVITY);
  const [picked, setPicked] = useState<string | null>(null);
  const [still, setStill] = useState(readStill);
  const toggleStill = () => {
    writeStill(!still);
    setStill(!still);
  };

  useEffect(() => {
    let live = true;
    bridge
      .listPets()
      .then((list) => {
        if (live) setPets(list);
      })
      .catch((error: unknown) => {
        console.error('could not list pets', error);
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [bridge]);

  useEffect(
    () => bridge.onTurnEvent((event) => setActivity((current) => nextActivity(current, event))),
    [bridge],
  );

  const members = useMemo<OfficeMember[]>(
    () =>
      (pets ?? []).map((pet) => ({
        pet,
        character: characterFor(pet),
        status: statusOf(activity, pet.id),
      })),
    [pets, activity],
  );
  const selectedId = members.some((m) => m.pet.id === picked)
    ? picked
    : (members[0]?.pet.id ?? null);

  const notice = failed ? (
    <p role="alert" style={{ margin: t.space.sm, fontSize: t.fontSize.body }}>
      Tagalong could not reach the crew. Check that the app finished starting, then reopen the
      office.
    </p>
  ) : pets === null ? (
    <p style={{ margin: t.space.sm, fontSize: t.fontSize.body, color: t.color.textMuted }}>
      Waking the crew…
    </p>
  ) : undefined;

  return (
    <div
      className={still ? 'office office-still' : 'office'}
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: t.color.page,
        color: t.color.text,
        fontFamily: t.font.ui,
        overflow: 'hidden',
      }}
    >
      <style>{OFFICE_CSS}</style>
      <TopBar still={still} onToggleStill={toggleStill} />
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <PartyList
          members={members}
          selectedId={selectedId}
          onSelect={setPicked}
          {...(notice !== undefined ? { notice } : {})}
        />
        <OfficeFloor members={members} selectedId={selectedId} />
        <MeetingsPanel />
      </div>
    </div>
  );
}

function TopBar({ still, onToggleStill }: { still: boolean; onToggleStill: () => void }) {
  const logo = CHARACTERS['scout'];
  return (
    <header
      style={{
        height: t.size.headerHeight,
        flex: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: t.space.xl,
        padding: `0 ${t.space.xxl}px`,
        borderBottom: `1px solid ${t.color.line}`,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: t.space.md + 2,
          width: t.size.partyWidth - t.space.xxl - t.space.xl,
        }}
      >
        {logo !== undefined && <PixelSprite sprite={logo.sprite} scale={t.spriteScale.logo} />}
        <h1
          className="office-px"
          style={{
            margin: 0,
            fontSize: t.fontSize.title,
            fontWeight: t.fontWeight.bold,
            letterSpacing: t.letterSpacing.title,
          }}
        >
          Tagalong HQ
        </h1>
      </div>
      <label title={NOT_YET} style={{ flex: 1, display: 'flex' }}>
        <span style={VISUALLY_HIDDEN}>Assign a task</span>
        <input
          className="office-field"
          disabled
          placeholder={NOT_YET}
          style={{
            flex: 1,
            background: t.color.field,
            border: `1px solid ${t.color.fieldLine}`,
            color: t.color.text,
          }}
        />
      </label>
      <button type="button" className="office-btn" disabled title={NOT_YET}>
        Assign
      </button>
      <button
        type="button"
        className="office-toggle"
        aria-pressed={still}
        title="Stop the crew's idle animation"
        onClick={onToggleStill}
      >
        Still office
      </button>
      <span
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: t.space.sm,
          fontSize: t.fontSize.body,
          color: t.color.textMuted,
          marginLeft: t.space.md,
        }}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          aria-hidden="true"
        >
          <path d="M4 14V2h7v12M2.5 14h11M8.5 8h.01" />
        </svg>
        {`${ROOM_COUNT} of ${ROOM_COUNT} rooms free`}
      </span>
    </header>
  );
}

const VISUALLY_HIDDEN = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
} as const;
