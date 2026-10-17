/** Tests for the body's sense of the machine: how many jobs may run, and why fewer. */
import { describe, expect, it } from 'vitest';
import { capacityFor, machineCapacity, type MachineOs } from './machine';

const GB = 1024 ** 3;

describe('capacityFor', () => {
  it('allows three on a machine with room', () => {
    expect(capacityFor({ freeBytes: 8 * GB, cpuBusy: 0.2 })).toEqual({ slots: 3 });
  });

  it('allows fewer when free memory is low, and says so', () => {
    expect(capacityFor({ freeBytes: 1.5 * GB, cpuBusy: 0.1 })).toEqual({
      slots: 2,
      busy: 'memory',
    });
    expect(capacityFor({ freeBytes: 0.5 * GB, cpuBusy: 0.1 })).toEqual({
      slots: 1,
      busy: 'memory',
    });
  });

  it('allows fewer when the CPU is busy', () => {
    expect(capacityFor({ freeBytes: 8 * GB, cpuBusy: 0.8 })).toEqual({ slots: 2, busy: 'cpu' });
    expect(capacityFor({ freeBytes: 8 * GB, cpuBusy: 0.95 })).toEqual({ slots: 1, busy: 'cpu' });
  });

  it('names memory when both are short', () => {
    expect(capacityFor({ freeBytes: 0.5 * GB, cpuBusy: 0.95 })).toEqual({
      slots: 1,
      busy: 'memory',
    });
  });
});

describe('machineCapacity', () => {
  function fakeOs(free: number, times: { idle: number; busy: number }[][], load = 0): MachineOs {
    let call = 0;
    return {
      freemem: () => free,
      loadavg: () => [load, load, load],
      cpus: () =>
        (times[Math.min(call++, times.length - 1)] ?? []).map((t) => ({
          times: { user: t.busy, nice: 0, sys: 0, idle: t.idle, irq: 0 },
        })),
    };
  }

  it('reads CPU use from the change in CPU times since the last reading', () => {
    const os = fakeOs(8 * GB, [[{ idle: 100, busy: 100 }], [{ idle: 105, busy: 195 }]]);
    expect(machineCapacity(os)()).toEqual({ slots: 1, busy: 'cpu' });
  });

  it('uses the load average where the system has one', () => {
    const os = fakeOs(
      8 * GB,
      [[{ idle: 0, busy: 0 }], [{ idle: 0, busy: 0 }], [{ idle: 0, busy: 0 }]],
      0.75,
    );
    expect(machineCapacity(os)()).toEqual({ slots: 2, busy: 'cpu' });
  });

  it('allows one when the machine cannot be read', () => {
    const os: MachineOs = {
      freemem: () => {
        throw new Error('nope');
      },
      loadavg: () => [0, 0, 0],
      cpus: () => [],
    };
    expect(machineCapacity(os)()).toEqual({ slots: 1 });
  });
});
