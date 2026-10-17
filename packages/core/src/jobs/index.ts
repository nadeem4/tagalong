/** Jobs module entry: Scout's own background work and the task board. */
export { JobStore, type JobRow, type JobState } from './store';
export {
  Jobs,
  JOB_DAILY_CAP,
  MAX_QUEUED_JOBS,
  type Capacity,
  type JobsOptions,
  type StartResult,
} from './jobs';
export { machineCapacity } from './machine';
export * from './board';
