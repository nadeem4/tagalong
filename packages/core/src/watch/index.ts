/** Phase 3B watch mode: a local poll and a cheap yes-or-no check, behind `watch_for`. */
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
