/**
 * Tests for the worker's hold on the offscreen mic page: it exists only while listening.
 */
import { describe, expect, it } from 'vitest';
import { createMicControl, type OffscreenApi } from './mic-control';

function fake(has = false) {
  const log: string[] = [];
  let exists = has;
  const offscreen: OffscreenApi = {
    exists: () => Promise.resolve(exists),
    create: () => {
      log.push('create');
      exists = true;
      return Promise.resolve();
    },
    close: () => {
      log.push('close');
      exists = false;
      return Promise.resolve();
    },
  };
  return { log, mic: createMicControl(offscreen) };
}

describe('mic control', () => {
  it('start_creates_the_page', async () => {
    const { log, mic } = fake();
    await mic.start();
    expect(log).toEqual(['create']);
  });

  it('stop_closes_it_and_a_stop_with_none_open_does_nothing', async () => {
    const { log, mic } = fake();
    await mic.stop();
    await mic.start();
    await mic.stop();
    expect(log).toEqual(['create', 'close']);
  });

  it('a_page_left_from_a_dead_worker_is_closed_and_remade', async () => {
    const { log, mic } = fake(true);
    await mic.start();
    expect(log).toEqual(['close', 'create']);
  });
});
