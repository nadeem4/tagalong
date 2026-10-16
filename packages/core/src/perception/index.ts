/**
 * Perception rules the engine applies to what hosts capture: exclusions, the window
 * inventory, browser routing, screenshot retention and text-layer notes. Nothing here
 * touches a screen; hosts do the capturing.
 */
export {
  findCaptureBlock,
  normalizeProcessName,
  secretFileRule,
  type ActiveWindow,
  type CaptureBlock,
} from './exclusions';
export {
  buildInventory,
  isBrowserProcess,
  renderInventory,
  type ObservedWindow,
} from './inventory';
export { browserContextFor } from './browser-route';
export { hasPixels, mayPersistScreenshot, withoutPixels } from './retention';
export { THIN_TEXT_CHARS, textLayerNotes, type TextLayerReading } from './text-layer';
export type { PerceptionHost } from './host';
