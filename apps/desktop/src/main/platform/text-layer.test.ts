import { describe, expect, it, vi } from 'vitest';

import { createUiaTextLayer, parseWindowCounts } from './text-layer';
import { handleOf } from './window-list';

describe('handleOf', () => {
  it('recovers the handle a window id was minted from', () => {
    expect(handleOf('w-123456')).toBe(123456);
  });

  it('refuses an id it did not mint', () => {
    // Ids come back from the model, which can invent one. A refusal is a read that fails
    // honestly; a coerced NaN would become a script targeting nothing.
    for (const bad of ['', 'w-', 'w-abc', '123456', 'w-1.5', 'w-1e9x', 'x-1']) {
      expect(handleOf(bad), bad).toBeNull();
    }
  });
});

describe('parseWindowCounts', () => {
  it('reads a count per handle', () => {
    const counts = parseWindowCounts(
      JSON.stringify([
        { handle: 11, chars: 456 },
        { handle: 22, chars: 34588 },
      ]),
    );

    expect(counts.get(11)).toBe(456);
    expect(counts.get(22)).toBe(34588);
  });

  it('keeps a zero, which is a fact rather than a missing answer', () => {
    expect(parseWindowCounts(JSON.stringify([{ handle: 11, chars: 0 }])).get(11)).toBe(0);
  });

  it('accepts the bare object PowerShell emits for one window', () => {
    expect(parseWindowCounts(JSON.stringify({ handle: 7, chars: 9 })).get(7)).toBe(9);
  });

  it('returns nothing for output that is not usable', () => {
    for (const junk of ['', 'At line:1 char:1', '{"broken":']) {
      expect(parseWindowCounts(junk).size).toBe(0);
    }
  });

  it('skips malformed rows without losing the good ones', () => {
    const counts = parseWindowCounts(
      JSON.stringify([{ handle: 'x', chars: 1 }, null, { handle: 5, chars: 2 }]),
    );

    expect(counts.size).toBe(1);
    expect(counts.get(5)).toBe(2);
  });
});

describe('createUiaTextLayer', () => {
  it('reads a window and returns its text', async () => {
    const run = vi
      .fn()
      .mockResolvedValue(
        JSON.stringify([{ name: 'error TS2532', type: 'Text', value: '', top: 1, left: 1 }]),
      );
    const layer = createUiaTextLayer(run);

    const reading = await layer.readWindowText(42, 8_000);

    expect(reading.text).toBe('error TS2532');
    expect(reading.truncated).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
    expect(String(run.mock.calls[0]?.[0])).toContain('42');
  });

  it('honours the character cap it was given', async () => {
    const run = vi.fn().mockResolvedValue(
      JSON.stringify([
        { name: 'aaaa', type: 'Text', value: '', top: 1, left: 0 },
        { name: 'bbbb', type: 'Text', value: '', top: 2, left: 0 },
      ]),
    );

    const reading = await createUiaTextLayer(run).readWindowText(42, 7);

    expect(reading.text).toBe('aaaa');
    expect(reading.truncated).toBe(true);
  });

  it('returns an empty read rather than throwing when the helper gives nothing', async () => {
    // PowerShell missing, blocked by policy, a window that closed between the inventory
    // and the read. None of those may cost the user their ask.
    //
    // It carries the failure as well as the emptiness: a helper that returned zero bytes
    // and a window that published zero characters are not the same thing, and a caller
    // that cannot tell them apart says "this window is empty" when the read never ran.
    const reading = await createUiaTextLayer(vi.fn().mockResolvedValue('')).readWindowText(42, 100);

    expect(reading).toEqual({ text: '', truncated: false, failure: 'no-output' });
  });

  it('survives the helper rejecting outright', async () => {
    const run = vi.fn().mockRejectedValue(new Error('spawn ENOENT'));

    await expect(createUiaTextLayer(run).readWindowText(42, 100)).resolves.toEqual({
      text: '',
      truncated: false,
      failure: 'no-output',
    });
  });

  it('counts several windows in one call, not one call per window', async () => {
    // Each call is a PowerShell start. Twelve windows must not mean twelve of them.
    const run = vi.fn().mockResolvedValue(JSON.stringify([{ handle: 1, chars: 10 }]));

    await createUiaTextLayer(run).countWindowText([1, 2, 3]);

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('skips the helper entirely when there is nothing to count', async () => {
    const run = vi.fn();

    const counts = await createUiaTextLayer(run).countWindowText([]);

    expect(counts.size).toBe(0);
    expect(run).not.toHaveBeenCalled();
  });

  it('returns no counts rather than failing when the counting pass breaks', async () => {
    const run = vi.fn().mockRejectedValue(new Error('timed out'));

    await expect(createUiaTextLayer(run).countWindowText([1])).resolves.toEqual(new Map());
  });
});
