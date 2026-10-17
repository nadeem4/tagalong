/** Jobs module entry: Scout's own background work (`Jobs`, `JobStore`) and the task board. */
export { JobStore, type JobRow, type JobState } from './store';
export {
  Jobs,
  JOB_DAILY_CAP,
  JOB_KEEP_DAYS,
  JOB_TIMEOUT_MS,
  MAX_QUEUED_JOBS,
  MAX_RUNNING_JOBS,
  type Capacity,
  type JobsOptions,
  type StartResult,
} from './jobs';
export { machineCapacity } from './machine';
export {
  boardItems,
  busyLine,
  shortId,
  longId,
  renderBoard,
  resolveId,
  type BoardItem,
  type BoardSources,
} from './board';
