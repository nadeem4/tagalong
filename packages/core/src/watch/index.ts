/** Watch mode entry: a local poll and a cheap yes-or-no model check, behind `watch_for`. */
export {
  WATCH_CHANGE_THRESHOLD,
  WATCH_POLL_MS,
  WATCH_SETTLE_MS,
  WatchManager,
  systemWatchClock,
  type WatchEvent,
  type WatchInfo,
} from './watch-manager';
