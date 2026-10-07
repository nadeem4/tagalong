import { useId } from 'react';
import type { Pet, Role, ToolGrant } from '@tagalong/protocol';
import { PixelSprite } from '../office/pixel-sprite';
import { characterFor } from '../office/sprites/characters';
import { officeTokens as t } from '../office/tokens';
import { reachableTools, roleInk, toolLabel } from './roles-view';

export interface DirectoryCardProps {
  pet: Pet;
  /** The name as typed, so the card follows the editor. */
  name: string;
  role: Role;
  grants: Readonly<Record<string, ToolGrant>>;
  /** fast, balanced, deep, or custom. */
  brain: string;
}

/** A pet's card in the crew directory, as its teammates read it. Never notes or memories. */
export function DirectoryCard({ pet, name, role, grants, brain }: DirectoryCardProps) {
  const headingId = useId();
  const reach = reachableTools(role, grants).map((toolId) => toolLabel(toolId).label);
  const line = (term: string, value: string) => (
    <div>
      <dt>{term}</dt> <dd>{value}</dd>
    </div>
  );
  return (
    <section className="tg-card" aria-labelledby={headingId}>
      <h3 id={headingId} className="tg-px">
        How teammates see {name}
      </h3>
      <div className="tg-card__who">
        <span className="tg-tile">
          <PixelSprite sprite={characterFor(pet).sprite} scale={t.spriteScale.party} />
        </span>
        <span>
          <span className="tg-px tg-name">{name}</span>
          <span className="tg-px tg-job" style={{ color: roleInk(role.name) }}>
            {role.name}
          </span>
        </span>
      </div>
      <p style={{ color: t.color.text, marginTop: 0, marginBottom: t.space.md }}>{role.summary}</p>
      <dl>
        {line('Good at', role.goodAt.join(', '))}
        {line('Not for', role.notFor.join(', '))}
        {line('Can reach', reach.length > 0 ? reach.join(', ') : 'nothing')}
        {line('Brain', brain)}
      </dl>
      <p>Notes and memories are never on the card.</p>
    </section>
  );
}
