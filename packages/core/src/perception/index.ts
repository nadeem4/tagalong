/** Pure capture-policy rules. Nothing here touches a screen; hosts do the capturing. */
export {
  findCaptureBlock,
  normalizeProcessName,
  type ActiveWindow,
  type CaptureBlock,
} from './exclusions';
export {
  buildInventory,
  isBrowserProcess,
  renderInventory,
  type ObservedWindow,
} from './inventory';
export { mayPersistScreenshot } from './retention';
export {
  GET_SELECTION,
  LOOK_AT_SCREEN,
  createPerceptionToolset,
  type PerceptionHost,
  type PerceptionToolset,
  type PerceptionToolsetOptions,
  type ToolOutcome,
} from './tools';
