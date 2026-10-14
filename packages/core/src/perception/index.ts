/** Pure capture-policy rules. Nothing here touches a screen; hosts do the capturing. */
export {
  appCaptureBlock,
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
export {
  BROWSER_HOST_TIMEOUT_MS,
  browserContextFor,
  captureSelection,
  isBrowserHost,
} from './browser-route';
export { mayPersistScreenshot } from './retention';
export { THIN_TEXT_CHARS, textLayerNotes, type TextLayerReading } from './text-layer';
export type { PerceptionHost } from './host';
