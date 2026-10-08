import { officeTheme } from './office-theme';
import type { Theme } from './theme';

/** Every theme Home can wear. Restaurant and Factory come later, as one entry each. */
export const THEMES: readonly Theme[] = [officeTheme];

export const DEFAULT_THEME: Theme = officeTheme;

/** The theme with this id; an unknown one falls back to the Office, never an empty scene. */
export function themeById(id: string): Theme {
  return THEMES.find((theme) => theme.id === id) ?? DEFAULT_THEME;
}
