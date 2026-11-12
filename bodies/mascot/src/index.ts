/* The public API. Forked from wobnimo's engine (MIT, see LICENSE). Most
   apps need only `mount` and a character; the rest is for building
   characters, props (`attachProps`) and other renderers. */

export {
  Mascot,
  mount,
  warm,
  isSupported,
  compileCached,
  type MascotOptions,
  type MascotEvents,
  type MascotMood,
  type Reveal,
} from './runtime/mascot';
export * from './props';
export { snapshot, type SnapshotOptions } from './runtime/snapshot';
export { driveFromStatus, type ChatStatus } from './runtime/status';
export { recolor, albedo, variant, defineCharacter, type Palette } from './runtime/customize';
export { STATES, EXPRESSIONS, type MascotState } from './behavior/states';
export { compile, type CompiledCharacter, type CompileOptions } from './compiler/compile';
export { SpecError } from './compiler/resolve';
export { Brain, type Pose, type BeatEvent } from './behavior/brain';
export { DEFAULT_FX, Fx } from './behavior/fx';
export { Rig } from './rig/rig';
export type { Renderer, Frame } from './render/renderer';
export { WebGL2Renderer } from './render/webgl2';
export type * from './spec/types';
