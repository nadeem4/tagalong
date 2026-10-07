import type { Role, ToolGrant } from '@tagalong/protocol';
import { CHARACTERS } from '../office/sprites/characters';
import { officeTokens } from '../office/tokens';

/** Each built-in tool in words a person reads in Settings. */
const TOOL_NAMES: Readonly<Record<string, string>> = {
  look_at_screen: 'Look at the screen',
  get_selection: 'Get the selection',
  list_displays: 'List displays',
  look_at_display: 'Look at one display',
  look_closer: 'Look closer',
  list_windows: 'List windows',
  read_window_text: 'Read window text',
  recall_screen: 'Recall the screen',
  what_changed: 'See what changed',
  watch_for: 'Watch for a change',
  remember: 'Remember',
  ask_pet: 'Ask a teammate',
};

/** The two tools that leave something behind after the turn; the rest only read. */
const WRITES: Readonly<Record<string, string>> = {
  remember: 'saves a memory',
  watch_for: 'starts a watch',
};

export interface ToolLabel {
  label: string;
  /** What using it does: "reads only", or what it leaves behind. */
  what: string;
}

export function toolLabel(toolId: string): ToolLabel {
  return {
    label: TOOL_NAMES[toolId] ?? toolId,
    what: WRITES[toolId] ?? 'reads only',
  };
}

/** The role's tools the grants leave on. A grant cannot add a tool the role does not list. */
export function reachableTools(role: Role, grants: Readonly<Record<string, ToolGrant>>): string[] {
  return role.tools.filter((toolId) => grants[toolId] !== 'off');
}

/** The brain on a directory card: the role's tier on the recommended model, else custom. */
export function brainLabel(role: Role, model: string, recommended: string | undefined): string {
  return recommended !== undefined && model === recommended ? role.model.tier : 'custom';
}

/**
 * A role's one label ink: the ink of the character whose job label names it (One Colour Per
 * Class), or the muted shell text for a role no character carries yet.
 */
export function roleInk(roleName: string): string {
  const upper = roleName.toUpperCase();
  const match = Object.values(CHARACTERS).find((character) => character.jobLabel === upper);
  return match?.labelInk ?? officeTokens.color.textMuted;
}
