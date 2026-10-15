import { describe, expect, it, vi } from 'vitest';

import { answerPointAt, displayRectToTarget, screenRectToTarget } from './point-target';
import type { PointDisplay } from './point-target';

const at = (scaleFactor: number): PointDisplay[] => [
  {
    id: 1,
    bounds: { x: 0, y: 0, width: 1920 / scaleFactor, height: 1080 / scaleFactor },
    scaleFactor,
  },
];

/** A single display at the origin: screen pixels are DIP times the scale. */
const scaled =
  (scaleFactor: number) => (rect: { x: number; y: number; width: number; height: number }) => ({
    x: rect.x / scaleFactor,
    y: rect.y / scaleFactor,
    width: rect.width / scaleFactor,
    height: rect.height / scaleFactor,
  });

describe('screenRectToTarget', () => {
  it.each([1, 1.5, 2])('turns screen pixels into the display and DIP at %sx', (scale) => {
    const target = screenRectToTarget(
      { x: 300, y: 600, width: 120, height: 60 },
      at(scale),
      scaled(scale),
    );
    expect(target).toEqual({
      displayId: 1,
      screen: 1,
      rect: {
        x: Math.round(300 / scale),
        y: Math.round(600 / scale),
        width: Math.round(120 / scale),
        height: Math.round(60 / scale),
      },
    });
  });

  it('finds a second monitor to the left, with a negative origin, and makes the rect local to it', () => {
    const displays: PointDisplay[] = [
      { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 },
      { id: 2, bounds: { x: -1280, y: 0, width: 1280, height: 720 }, scaleFactor: 1.5 },
    ];
    const target = screenRectToTarget(
      { x: -1800, y: 150, width: 150, height: 75 },
      displays,
      // Windows' own conversion: on the left monitor, pixels shrink by its scale.
      (rect) =>
        rect.x < 0
          ? { x: rect.x / 1.5, y: rect.y / 1.5, width: rect.width / 1.5, height: rect.height / 1.5 }
          : rect,
    );
    expect(target).toEqual({
      displayId: 2,
      screen: 2,
      rect: { x: 80, y: 100, width: 100, height: 50 },
    });
  });

  it('clamps a rect that runs off the edge', () => {
    const target = screenRectToTarget(
      { x: 1900, y: 1060, width: 100, height: 100 },
      at(1),
      scaled(1),
    );
    expect(target?.rect).toEqual({ x: 1900, y: 1060, width: 20, height: 20 });
  });

  it('answers null for a rect on no display', () => {
    expect(
      screenRectToTarget({ x: 5000, y: 5000, width: 10, height: 10 }, at(1), scaled(1)),
    ).toBeNull();
  });
});

describe('displayRectToTarget', () => {
  it.each([1, 1.5, 2])("divides the display's own pixels by its scale at %sx", (scale) => {
    const target = displayRectToTarget(1, { x: 300, y: 600, width: 120, height: 60 }, at(scale));
    expect(target?.rect).toEqual({
      x: Math.round(300 / scale),
      y: Math.round(600 / scale),
      width: Math.round(120 / scale),
      height: Math.round(60 / scale),
    });
  });

  it('answers null for an unknown display or a rect off it', () => {
    expect(displayRectToTarget(9, { x: 0, y: 0, width: 10, height: 10 }, at(1))).toBeNull();
    expect(displayRectToTarget(1, { x: 4000, y: 0, width: 10, height: 10 }, at(1))).toBeNull();
  });
});

describe('answerPointAt', () => {
  function deps(found: Awaited<ReturnType<Parameters<typeof answerPointAt>[0]['findElement']>>) {
    return {
      findElement: vi.fn().mockResolvedValue(found),
      displays: () => at(1),
      toDip: scaled(1),
      show: vi.fn(),
    };
  }

  it('shows the ring around a found element, with its label', async () => {
    const d = deps({ found: true, rect: { x: 10, y: 20, width: 30, height: 40 } });
    const answer = await answerPointAt(d, { windowId: 'w-1', name: 'Export', label: 'Export' });
    expect(answer).toEqual({ shown: true, screen: 1 });
    expect(d.show).toHaveBeenCalledWith({
      displayId: 1,
      screen: 1,
      rect: { x: 10, y: 20, width: 30, height: 40 },
      label: 'Export',
    });
  });

  it('passes a refusal on and shows nothing', async () => {
    const blocked = { rule: 'processName' as const, entry: '1Password.exe' };
    const d = deps({ found: false, blocked, notes: ['excluded'] });
    expect(await answerPointAt(d, { windowId: 'w-1', name: 'Vault' })).toEqual({
      shown: false,
      blocked,
      notes: ['excluded'],
    });
    expect(d.show).not.toHaveBeenCalled();
  });

  it('points at a display rectangle without searching any window', async () => {
    const d = deps({ found: false, notes: [] });
    const answer = await answerPointAt(d, {
      displayId: 1,
      rect: { x: 0, y: 0, width: 50, height: 50 },
    });
    expect(answer).toEqual({ shown: true, screen: 1 });
    expect(d.findElement).not.toHaveBeenCalled();
    expect(d.show).toHaveBeenCalledWith(expect.objectContaining({ label: '' }));
  });

  it('says so when the place is on no screen', async () => {
    const d = deps({ found: true, rect: { x: 9000, y: 9000, width: 10, height: 10 } });
    const answer = await answerPointAt(d, { windowId: 'w-1', name: 'Export' });
    expect(answer.shown).toBe(false);
    expect(answer.notes?.[0]).toMatch(/not on any screen/);
    expect(d.show).not.toHaveBeenCalled();
  });
});
