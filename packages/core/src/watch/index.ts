/** Phase 3B watch mode: a local poll, a cheap yes-or-no check, and the tool that starts it. */
export {
  WATCH_CHANGE_THRESHOLD,
  WATCH_POLL_MS,
  WATCH_SETTLE_MS,
  WatchManager,
  parseVerdict,
  systemWatchClock,
  type StartOutcome,
  type StartWatch,
  type WatchClock,
  type WatchEvent,
  type WatchInfo,
  type WatchManagerOptions,
} from './watch-manager';
export { WATCH_FOR, watchTool, type WatchToolDeps } from './watch-tool';
