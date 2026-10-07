import { PixelSprite } from './pixel-sprite';
import { CHARACTERS } from './sprites/characters';
import { officeTokens as t } from './tokens';

/** How many segments the call meter draws. */
const CALL_METER_SEGMENTS = 12;

/**
 * The right-hand panel. Meetings do not exist in the engine yet, so it keeps its three
 * areas — the meeting tabs, the thread, the call meter — and fills them with an honest
 * empty state rather than sample data.
 */
export function MeetingsPanel() {
  const scout = CHARACTERS['scout'];
  const ink = CHARACTERS['ink'];
  return (
    <aside
      aria-label="Meetings"
      style={{
        flex: 1,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        background: t.color.panel,
        color: t.color.panelText,
      }}
    >
      <div
        data-area="meeting-tabs"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: t.space.xxs,
          padding: `${t.space.lg - 2}px ${t.space.xxl}px`,
          borderBottom: `1px solid ${t.color.panelLine}`,
        }}
      >
        <span style={{ fontSize: t.fontSize.field, fontWeight: t.fontWeight.semibold }}>
          Meetings
        </span>
        <span style={{ fontSize: t.fontSize.small, color: t.color.panelMuted }}>None yet</span>
      </div>

      <div
        data-area="meeting-thread"
        style={{
          flex: 1,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: t.space.lg,
          padding: `${t.space.xxxl}px ${t.space.xxxl + 8}px`,
          textAlign: 'center',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: t.space.md }}>
          {scout !== undefined && <PixelSprite sprite={scout.sprite} scale={t.spriteScale.party} />}
          <span
            aria-hidden="true"
            className="office-px"
            style={{
              fontSize: t.fontSize.title,
              color: t.color.panelMuted,
              paddingBottom: t.space.xl,
            }}
          >
            · · ·
          </span>
          {ink !== undefined && <PixelSprite sprite={ink.sprite} scale={t.spriteScale.party} />}
        </div>
        <p
          className="office-px"
          style={{ margin: 0, fontSize: t.fontSize.petName, fontWeight: t.fontWeight.semibold }}
        >
          No meetings yet
        </p>
        <p
          style={{
            margin: 0,
            maxWidth: t.size.emptyTextWidth,
            fontSize: t.fontSize.field,
            lineHeight: 1.5,
            color: t.color.panelMuted,
          }}
        >
          When pets meet, their meetings appear here: who booked which room, what they said, and any
          call they need you to make.
        </p>
        <p style={{ margin: 0, fontSize: t.fontSize.small, color: t.color.panelMuted }}>
          Meetings arrive in a later update.
        </p>
      </div>

      <div
        data-area="call-meter"
        style={{
          padding: `${t.space.lg}px ${t.space.xl}px ${t.space.xl}px`,
          display: 'flex',
          alignItems: 'center',
          gap: t.space.lg - 2,
          borderTop: `1px solid ${t.color.panelLine}`,
        }}
      >
        <span style={{ fontSize: t.fontSize.small, color: t.color.panelMuted }}>Calls</span>
        <span aria-hidden="true" style={{ flex: 1, display: 'flex', gap: t.space.hair }}>
          {Array.from({ length: CALL_METER_SEGMENTS }, (_, index) => (
            <span
              key={index}
              style={{ flex: 1, height: t.size.meterHeight, background: t.color.meterOff }}
            />
          ))}
        </span>
        <span style={{ fontSize: t.fontSize.small, color: t.color.panelMuted }}>None yet</span>
      </div>
    </aside>
  );
}
