/**
 * The public surface of @tagalong/core: the `Engine` and the few helpers the desktop host
 * imports (settings store, secret store, capture-block and window-inventory helpers, role
 * and model helpers). Pure Node: no electron, react or DOM globals (an ESLint rule enforces
 * it). Hosts boot an Engine and then speak the protocol.
 */
export { Engine } from './engine';

export { getRole, recommendedModel } from './roles';

export { InMemorySecretStore, SettingsStore, type SecretStore } from './settings/settings';

export {
  buildInventory,
  THIN_TEXT_CHARS,
  findCaptureBlock,
  textLayerNotes,
  normalizeProcessName,
  secretFileRule,
  type CaptureBlock,
  type ObservedWindow,
} from './perception';

export { talkPatchProblem, type ToolKind } from './tools';

export { OPENAI_COMPATIBLE_PRESETS, SECRET_KEYS, WATCH_MODEL_DEFAULTS } from './providers';

export { callOrFullScreenInFront } from './keep-an-eye/lookout';
