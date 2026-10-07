import type { ReactNode } from 'react';
import type { OfficeMember } from './member';
import { PixelSprite } from './pixel-sprite';
import { StatusLine } from './status-line';
import { officeTokens as t } from './tokens';

export interface PartyListProps {
  members: readonly OfficeMember[];
  selectedId: string | null;
  onSelect: (petId: string) => void;
  /** Shown under the heading instead of rows: loading, or a reason the crew is missing. */
  notice?: ReactNode;
}

/** The crew down the left side. Each row is a real button; the selected one is ringed gold. */
export function PartyList({ members, selectedId, onSelect, notice }: PartyListProps) {
  return (
    <nav
      aria-label="Party"
      style={{
        width: t.size.partyWidth,
        flex: 'none',
        boxSizing: 'border-box',
        padding: `${t.space.xl}px ${t.space.lg + 2}px`,
        background: t.color.sidebar,
        overflowY: 'auto',
      }}
    >
      <div style={{ padding: `0 ${t.space.sm}px ${t.space.md}px` }}>
        <span
          className="office-px"
          style={{
            fontSize: t.fontSize.partyHeading,
            fontWeight: t.fontWeight.semibold,
            letterSpacing: t.letterSpacing.pixel,
            color: t.color.textMuted,
          }}
        >
          PARTY · {members.length}
        </span>
      </div>
      {notice}
      <ul
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: t.space.sm,
        }}
      >
        {members.map(({ pet, character, status }) => (
          <li key={pet.id}>
            <button
              type="button"
              className="office-row"
              aria-pressed={pet.id === selectedId}
              onClick={() => onSelect(pet.id)}
            >
              <span
                style={{
                  flex: 'none',
                  padding: t.space.xs,
                  borderRadius: t.radius.tile,
                  background: t.color.avatarTile,
                }}
              >
                <PixelSprite sprite={character.sprite} scale={t.spriteScale.party} />
              </span>
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: t.space.hair,
                }}
              >
                <span
                  className="office-px"
                  style={{ fontSize: t.fontSize.petName, fontWeight: t.fontWeight.semibold }}
                >
                  {pet.name}
                </span>
                <span
                  className="office-px"
                  style={{
                    fontSize: t.fontSize.min,
                    letterSpacing: t.letterSpacing.pixel,
                    color: character.labelInk,
                  }}
                >
                  {character.jobLabel}
                </span>
                <StatusLine status={status} />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
