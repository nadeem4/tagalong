/**
 * The check-in moment entry: `CheckIn`, its options and the gate's limits, and `Arrivals`,
 * which gathers finished work into one check-in.
 */
export { AFTER_TALK_MS, ARRIVAL_WINDOW_MS, Arrivals, fromHandoff, fromJob } from './arrivals';
export {
  CHECK_IN_DAILY_CAP,
  COOLDOWN_MS,
  CheckIn,
  NOT_NOW_MS,
  type CheckInOptions,
} from './check-in';
