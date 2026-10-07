import { useId } from 'react';
import type { Role } from '@tagalong/protocol';
import { AlertIcon } from './icons';

export interface RolePickerProps {
  petName: string;
  roles: readonly Role[];
  roleId: string;
  /** The role the pet has now, so a change can be called out before it is saved. */
  savedRoleId: string;
  onChange: (roleId: string) => void;
}

/** One role per pet, as a set of choices, with the chosen role's summary and strengths. */
export function RolePicker({ petName, roles, roleId, savedRoleId, onChange }: RolePickerProps) {
  const group = useId();
  if (roles.length === 0) {
    return <p className="tg-note">Roles load from the engine. This pet does: {roleId}.</p>;
  }
  const chosen = roles.find((role) => role.id === roleId);
  return (
    <div>
      <fieldset className="tg-choices">
        <legend className="tg-note">Role</legend>
        {roles.map((role) => (
          <label key={role.id} className="tg-choice">
            <input
              type="radio"
              name={group}
              value={role.id}
              checked={role.id === roleId}
              onChange={() => onChange(role.id)}
            />
            <span className="tg-choice__name">{role.name}</span>
          </label>
        ))}
      </fieldset>
      {chosen !== undefined && (
        <>
          <p style={{ margin: 0 }}>{chosen.summary}</p>
          <ul className="tg-chips" aria-label="Good at">
            {chosen.goodAt.map((item) => (
              <li key={item} className="tg-chip">
                {item}
              </li>
            ))}
          </ul>
        </>
      )}
      {roleId !== savedRoleId && (
        <p role="note" className="tg-warning">
          <AlertIcon />
          <span>
            Changing role replaces {petName}&apos;s instructions and tools. Name, look, notes and
            memories stay.
          </span>
        </p>
      )}
    </div>
  );
}
