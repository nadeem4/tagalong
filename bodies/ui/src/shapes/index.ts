/**
 * The shapes the desktop and the shared UI both use: context, status marks, voice slots,
 * addressing, apps, the pet, memory entries and the turn events. React-free (a source guard
 * enforces it), so desktop main, the brain and the renderer can all import it as
 * `@tagalong/ui/shapes`.
 */
export * from './addressing';
export * from './apps';
export * from './context';
export * from './memory';
export * from './pet';
export * from './status';
export * from './turn-events';
export * from './voice';
