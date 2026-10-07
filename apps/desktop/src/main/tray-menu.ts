import type { MenuItemConstructorOptions } from 'electron';

/** What each tray item does. Main supplies these; the template only arranges them. */
export interface TrayActions {
  togglePets: () => void;
  toggleSightPause: () => void;
  openOffice: () => void;
  openSettings: () => void;
  openOnboarding: () => void;
  quit: () => void;
}

/** The tray menu, rebuilt whenever pause flips so the checkmark cannot drift. */
export function trayMenuTemplate(
  actions: TrayActions,
  state: { sightPaused: boolean },
): MenuItemConstructorOptions[] {
  return [
    { label: 'Show or hide pets', click: () => actions.togglePets() },
    { label: 'Open office', click: () => actions.openOffice() },
    {
      label: 'Pause sight',
      type: 'checkbox',
      checked: state.sightPaused,
      click: () => actions.toggleSightPause(),
    },
    { label: 'Settings', click: () => actions.openSettings() },
    { label: 'Setup wizard', click: () => actions.openOnboarding() },
    { type: 'separator' },
    { label: 'Quit', click: () => actions.quit() },
  ];
}
