/**
 * Keycap and Shortcut: a key drawn as a key, and an Electron accelerator split into keys.
 * Electron's own names (CommandOrControl) never reach the screen.
 */
import type { ReactNode } from 'react';

/** Electron accelerator tokens in the words people read on a keyboard. */
const KEY_NAMES: Record<string, string> = {
  commandorcontrol: 'Ctrl',
  cmdorctrl: 'Ctrl',
  command: 'Cmd',
  cmd: 'Cmd',
  control: 'Ctrl',
  ctrl: 'Ctrl',
};

export function Keycap({ children }: { children: ReactNode }) {
  return <kbd className="tg-keycap">{children}</kbd>;
}

export function Shortcut({ accelerator }: { accelerator: string }) {
  const keys = accelerator
    .split('+')
    .map((key) => key.trim())
    .filter((key) => key !== '');
  if (keys.length === 0) return null;
  return (
    <span className="tg-shortcut">
      {keys.map((key, index) => (
        <Keycap key={`${index}-${key}`}>{KEY_NAMES[key.toLowerCase()] ?? key}</Keycap>
      ))}
    </span>
  );
}
