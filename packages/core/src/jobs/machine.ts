/**
 * The body's sense of the machine, read when a job would start: free memory and how busy the
 * CPU is decide how many jobs may run at once (1-3). A reflex, like energy: the mind cannot
 * measure RAM, so the board tells it the result and why. Contains `capacityFor` (pure) and
 * `machineCapacity` (reads `node:os`).
 */
import * as nodeOs from 'node:os';
import type { Capacity } from './jobs';

const GB = 1024 ** 3;

export interface MachineReading {
  freeBytes: number;
  /** 0-1: the share of CPU time not idle. */
  cpuBusy: number;
}

/** The parts of `node:os` read here. */
export interface MachineOs {
  freemem(): number;
  loadavg(): number[];
  cpus(): { times: { user: number; nice: number; sys: number; idle: number; irq: number } }[];
}

/** Low free memory or a busy CPU lets fewer run; memory is named first when both are short. */
export function capacityFor(reading: MachineReading): Capacity {
  const byMemory = reading.freeBytes < 1 * GB ? 1 : reading.freeBytes < 2 * GB ? 2 : 3;
  const byCpu = reading.cpuBusy > 0.9 ? 1 : reading.cpuBusy > 0.7 ? 2 : 3;
  const slots = Math.min(byMemory, byCpu);
  if (slots === 3) return { slots };
  return { slots, busy: byMemory <= byCpu ? 'memory' : 'cpu' };
}

/**
 * Reads the machine on each call. CPU use is the change in CPU times since the previous
 * reading (Windows has no load average), or the load average per core where there is one,
 * whichever is higher. A machine that cannot be read allows one.
 */
export function machineCapacity(os: MachineOs = nodeOs): () => Capacity {
  let last = cpuTimes(os);
  return () => {
    try {
      const now = cpuTimes(os);
      const total = now.total - last.total;
      const sampled = total > 0 ? 1 - (now.idle - last.idle) / total : 0;
      last = now;
      const cores = Math.max(1, os.cpus().length);
      const load = (os.loadavg()[0] ?? 0) / cores;
      return capacityFor({ freeBytes: os.freemem(), cpuBusy: Math.max(sampled, load) });
    } catch {
      return { slots: 1 };
    }
  };
}

function cpuTimes(os: MachineOs): { idle: number; total: number } {
  let idle = 0;
  let total = 0;
  for (const { times } of os.cpus()) {
    idle += times.idle;
    total += times.user + times.nice + times.sys + times.idle + times.irq;
  }
  return { idle, total };
}
