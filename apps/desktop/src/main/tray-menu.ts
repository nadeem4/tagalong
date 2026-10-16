/** The tray menu's items. Contains trayMenuTemplate; main supplies the actions. */

import type { MenuItemConstructorOptions } from 'electron';

/** What each tray item does. Main supplies these; the template only arranges them. */
export interface TrayActions {
  togglePets: () => void;
  toggleSightPause: () => void;
  openHome: () => void;
  quit: () => void;
}

/**
 * The tray menu, rebuilt whenever pause flips so the checkmark cannot drift. Four items:
 * Home holds everything else (Scout, experts, activity, settings, Welcome).
 */
export function trayMenuTemplate(
  actions: TrayActions,
  state: { sightPaused: boolean },
): MenuItemConstructorOptions[] {
  return [
    { label: 'Open Tagalong', click: () => actions.openHome() },
    {
      label: 'Pause sight',
      type: 'checkbox',
      checked: state.sightPaused,
      click: () => actions.toggleSightPause(),
    },
    { label: 'Show or hide Scout', click: () => actions.togglePets() },
    { type: 'separator' },
    { label: 'Quit', click: () => actions.quit() },
  ];
}
