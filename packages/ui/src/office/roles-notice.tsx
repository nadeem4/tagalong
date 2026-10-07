import { useEffect, useId, useRef, useState } from 'react';
import type { Role, RolesUpgradeNotice, RolesUpgradeNoticePet } from '@tagalong/protocol';
import { jobFor } from './job';
import type { OfficeMember } from './member';
import { PixelSprite } from './pixel-sprite';
import { officeTokens as t } from './tokens';

/** One plain sentence on what the upgrade did to this pet. */
export function whatHappened(pet: RolesUpgradeNoticePet): string {
  if (pet.madeByYou) {
    return pet.keptNotes
      ? 'A pet you made. Your persona is kept as notes; pick a better role any time.'
      : 'A pet you made; pick a better role any time.';
  }
  return pet.keptNotes
    ? 'Your edited persona is kept as notes.'
    : 'Default persona replaced by the role.';
}

export interface RolesNoticeProps {
  notice: RolesUpgradeNotice;
  roles: readonly Role[];
  /** The crew as the office draws it, for each row's sprite. */
  members: readonly OfficeMember[];
  /** Got it, Escape, or Review my crew: the notice has been seen. */
  onDismiss: () => void;
  /** Absent when the host has no Settings to open, and the button is left out. */
  onReview?: () => void;
}

const ROW = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1.3fr) 20px minmax(0, 1.4fr) minmax(0, 2.2fr)',
  gap: t.space.lg,
  alignItems: 'center',
  padding: `${t.space.md}px 0`,
  borderBottom: `1px solid ${t.color.line}`,
} as const;

/**
 * "Your crew has roles now": shown once over the office after an install from before roles
 * is upgraded. A modal `<dialog>`, so the office behind it is inert, focus stays inside,
 * and Escape works as Got it.
 */
export function RolesNotice({ notice, roles, members, onDismiss, onReview }: RolesNoticeProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const gotIt = useRef<HTMLButtonElement>(null);
  const [more, setMore] = useState(false);
  const titleId = useId();
  const detailsId = useId();

  useEffect(() => {
    const element = dialog.current;
    if (element !== null && !element.open) element.showModal();
    gotIt.current?.focus();
  }, []);

  return (
    <dialog
      ref={dialog}
      className="office-notice"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onDismiss();
      }}
      style={{
        width: t.size.noticeWidth,
        maxWidth: `calc(100vw - ${t.space.xxxl * 2}px)`,
        boxSizing: 'border-box',
        padding: `${t.space.xxl + 4}px ${t.space.xxxl + 4}px`,
        border: `1px solid ${t.color.fieldLine}`,
        borderRadius: t.radius.tile,
        background: t.color.sidebar,
        color: t.color.text,
        fontFamily: t.font.ui,
      }}
    >
      <h2
        id={titleId}
        className="office-px"
        style={{
          margin: 0,
          fontSize: t.fontSize.title,
          fontWeight: t.fontWeight.bold,
          letterSpacing: t.letterSpacing.title,
        }}
      >
        Your crew has roles now
      </h2>
      <p
        style={{
          margin: `${t.space.md}px 0 ${t.space.xl}px`,
          fontSize: t.fontSize.field,
          lineHeight: 1.5,
          color: t.color.textMuted,
        }}
      >
        Every pet now has one job. The role tells it what it is good at, which tools it uses, and
        how teammates should ask it for help. Names, looks, conversations and memories are
        untouched.
      </p>

      <div role="table" aria-label="What happened to each pet">
        <div role="row" style={{ ...ROW, paddingTop: 0 }}>
          {['Pet', '', 'New role', 'What happened'].map((heading, index) => (
            <span
              key={index}
              role="columnheader"
              style={{ fontSize: t.fontSize.small, color: t.color.textMuted }}
            >
              {heading}
            </span>
          ))}
        </div>
        {notice.pets.map((row) => {
          const job = jobFor(row.roleId, roles);
          const character = members.find((member) => member.pet.id === row.petId)?.character;
          return (
            <div key={row.petId} role="row" style={ROW}>
              <span
                role="cell"
                style={{ display: 'flex', alignItems: 'center', gap: t.space.md, minWidth: 0 }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    flex: 'none',
                    padding: t.space.xs,
                    borderRadius: t.radius.small,
                    background: t.color.avatarTile,
                    lineHeight: 0,
                  }}
                >
                  {character !== undefined && (
                    <PixelSprite sprite={character.sprite} scale={t.spriteScale.tile} />
                  )}
                </span>
                <span
                  className="office-px"
                  style={{ fontSize: t.fontSize.petName, fontWeight: t.fontWeight.semibold }}
                >
                  {row.name}
                </span>
              </span>
              <span role="cell" aria-label="becomes" style={{ color: t.color.textMuted }}>
                →
              </span>
              <span
                role="cell"
                className="office-px"
                style={{
                  fontSize: t.fontSize.min,
                  letterSpacing: t.letterSpacing.pixel,
                  color: job.ink,
                }}
              >
                {job.label}
              </span>
              <span role="cell" style={{ fontSize: t.fontSize.body, color: t.color.text }}>
                {whatHappened(row)}
              </span>
            </div>
          );
        })}
      </div>

      {more && (
        <div
          id={detailsId}
          style={{
            marginTop: t.space.lg,
            padding: `${t.space.lg}px ${t.space.xl}px`,
            borderRadius: t.radius.small,
            background: t.color.field,
            fontSize: t.fontSize.body,
            lineHeight: 1.55,
            display: 'flex',
            flexDirection: 'column',
            gap: t.space.xs,
          }}
        >
          <p style={{ margin: 0 }}>
            <strong>Instructions</strong> now come from the role. A persona you wrote yourself is
            kept as <strong>notes</strong>, added after the role.
          </p>
          <p style={{ margin: 0 }}>
            <strong>Models</strong> are unchanged. Settings shows the model each role recommends, if
            you want to switch.
          </p>
          <p style={{ margin: 0 }}>
            <strong>Tools</strong> are now per role, and you can turn any of them off per pet.
          </p>
        </div>
      )}

      <div
        style={{ display: 'flex', alignItems: 'center', gap: t.space.lg, marginTop: t.space.xxl }}
      >
        <button
          type="button"
          className="office-link"
          aria-expanded={more}
          aria-controls={detailsId}
          onClick={() => setMore(!more)}
        >
          {more ? 'Hide details' : 'What changed?'}
        </button>
        <span style={{ flex: 1 }} />
        {onReview !== undefined && (
          <button type="button" className="office-toggle" onClick={onReview}>
            Review my crew
          </button>
        )}
        <button ref={gotIt} type="button" className="office-btn" onClick={onDismiss}>
          Got it
        </button>
      </div>
    </dialog>
  );
}
