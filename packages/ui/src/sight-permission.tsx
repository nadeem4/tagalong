import type { Settings } from '@tagalong/protocol';

export type SightMode = Settings['sight'];

export interface SightPermissionProps {
  value: SightMode;
  onChange: (mode: SightMode) => void;
  /** Disables both choices, for while a change is being saved. */
  disabled?: boolean;
}

const CHOICES: readonly { mode: SightMode; label: string; explain: string }[] = [
  {
    mode: 'when-asked',
    label: 'When I ask',
    explain: 'Tagalong reads your screen only when you press a look key.',
  },
  {
    mode: 'always',
    label: 'Always',
    explain:
      'Tagalong keeps the last few minutes of your screen in memory and adds a picture of the window you are in to every question. Nothing is sent until you ask.',
  },
];

/** The sight permission: when Tagalong may look at the screen. */
export function SightPermission({ value, onChange, disabled = false }: SightPermissionProps) {
  return (
    <div role="radiogroup" aria-label="Sight permission">
      {CHOICES.map((choice) => (
        <div key={choice.mode}>
          <label className="tg-check">
            <input
              type="radio"
              name="sight"
              value={choice.mode}
              checked={value === choice.mode}
              disabled={disabled}
              onChange={() => onChange(choice.mode)}
            />
            <span>{choice.label}</span>
          </label>
          <p className="tg-note">{choice.explain}</p>
        </div>
      ))}
    </div>
  );
}
