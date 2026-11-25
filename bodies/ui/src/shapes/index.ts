/**
 * The shapes the desktop and the shared UI both use: context, status marks, voice slots,
 * addressing, echo matching, apps, the pet, memory entries and the turn events. React-free (a source guard
 * enforces it), so desktop main, the brain and the renderer can all import it as
 * `@tagalong/ui/shapes`.
 */
export * from './addressing';
export * from './ai-tools';
export * from './apps';
export * from './bodies';
export * from './context';
export * from './devices';
export * from './tailscale';
export * from './echo';
export * from './know-me';
export * from './events';
export * from './tasks';
export * from './loops';
export * from './model';
export * from './needs-you';
export * from './memory';
export * from './pairing';
export * from './pet';
export * from './placements';
export * from './reading';
export * from './setup';
export * from './status';
export * from './timeline';
export * from './timers';
export * from './turn-events';
export * from './updates';
export * from './voice';
export * from './voice-models';
export * from './voice-download';
export * from './voice-picker';
