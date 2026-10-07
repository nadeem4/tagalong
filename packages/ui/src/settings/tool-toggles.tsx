import type { Role, ToolGrant } from '@tagalong/protocol';
import { CheckIcon, OffIcon } from './icons';
import { toolLabel } from './roles-view';

export interface ToolTogglesProps {
  role: Role;
  grants: Readonly<Record<string, ToolGrant>>;
  onChange: (grants: Record<string, ToolGrant>) => void;
}

/**
 * One switch per tool the role lists. The role decides which tools are offered; the user
 * decides which are on. A tool the role does not list is not shown at all.
 */
export function ToolToggles({ role, grants, onChange }: ToolTogglesProps) {
  return (
    <ul className="tg-tools">
      {role.tools.map((toolId) => {
        const { label, what } = toolLabel(toolId);
        const on = grants[toolId] !== 'off';
        return (
          <li key={toolId}>
            <span>
              <span>{label}</span> <small>· {what}</small>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={on}
              aria-label={label}
              className="tg-switch"
              onClick={() => onChange({ ...grants, [toolId]: on ? 'off' : 'allowed' })}
            >
              {on ? <CheckIcon /> : <OffIcon />}
              {on ? 'On' : 'Off'}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
