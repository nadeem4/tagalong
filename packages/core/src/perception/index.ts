/** Pure capture-policy rules. Nothing here touches a screen; hosts do the capturing. */
export { findCaptureBlock, type ActiveWindow, type CaptureBlock } from './exclusions';
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
