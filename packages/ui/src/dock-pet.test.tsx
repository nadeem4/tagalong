import { render, screen } from '@testing-library/react';
import { act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Pet } from '@tagalong/protocol';
import { DockPet } from './dock-pet';
import { CHARACTERS } from './office/sprites/characters';
import { withBlink, withMood } from './office/sprites/expressions';

const SCOUT: Pet = {
  id: 'scout',
  name: 'Scout',
  avatar: '🦊',
  roleId: 'companion',
  roleVersion: 1,
  model: 'haiku',
  providerId: 'claude-code',
  toolGrants: {},
  replyStyle: 'text',
};

describe('withMood', () => {
  const base = CHARACTERS['scout']!.sprite;

  it('keeps the face as drawn when idle', () => {
    expect(withMood(base, 'idle')).toBe(base);
  });

  it('gives every other mood its own eyes, and changes nothing else', () => {
    const faces = (['listening', 'working', 'done'] as const).map((mood) =>
      withMood(base, mood).rows.join('\n'),
    );
    expect(new Set([base.rows.join('\n'), ...faces]).size).toBe(4);
    for (const mood of ['listening', 'working', 'done'] as const) {
      const rows = withMood(base, mood).rows;
      expect(rows.slice(0, 4)).toEqual(base.rows.slice(0, 4));
      expect(rows.slice(8)).toEqual(base.rows.slice(8));
      expect(withMood(base, mood).palette).toBe(base.palette);
    }
  });

  it('leaves a sprite of another shape alone', () => {
    const tiny = { rows: ['ab'], palette: { a: '#000', b: '#fff' } };
    expect(withMood(tiny, 'working')).toBe(tiny);
  });
});

describe('DockPet', () => {
  it('draws the pet and says what it is doing, with a tag for anything but idle', () => {
    const { rerender } = render(<DockPet pet={SCOUT} mood="idle" />);
    expect(screen.getByRole('img')).toHaveAccessibleName('Scout is idle');
    expect(screen.queryByTestId('dock-tag')).toBeNull();

    rerender(<DockPet pet={SCOUT} mood="listening" />);
    expect(screen.getByTestId('dock-tag')).toHaveTextContent('Seeing');
    rerender(<DockPet pet={SCOUT} mood="working" />);
    expect(screen.getByTestId('dock-tag')).toHaveTextContent('Working');
    rerender(<DockPet pet={SCOUT} mood="done" />);
    expect(screen.getByTestId('dock-tag')).toHaveTextContent('Done');
    expect(screen.getByRole('img')).toHaveAccessibleName('Scout has an answer for you');
  });

  it('shows that sight is paused, and that memory is recording, in marks and words', () => {
    const { rerender } = render(<DockPet pet={SCOUT} mood="idle" sightPaused />);
    expect(screen.getByTestId('paused-eye')).toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAccessibleName('Scout is idle, sight paused');
    rerender(<DockPet pet={SCOUT} mood="idle" recording />);
    expect(screen.getByTestId('recording-dot')).toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAccessibleName('Scout is idle, recording the screen');
  });
});

describe('a living pet', () => {
  afterEach(() => vi.useRealTimers());

  it('closes its eyes for a blink, and changes nothing else', () => {
    const base = CHARACTERS['scout']!.sprite;
    const blink = withBlink(base);
    expect(blink.rows).not.toEqual(base.rows);
    expect(blink.rows.slice(0, 5)).toEqual(base.rows.slice(0, 5));
    expect(blink.rows.slice(7)).toEqual(base.rows.slice(7));
  });

  it('blinks now and then, briefly', () => {
    vi.useFakeTimers();
    render(<DockPet pet={SCOUT} mood="idle" blinkEveryMs={3000} />);
    const pet = screen.getByRole('img');
    expect(pet).toHaveAttribute('data-blink', 'false');
    act(() => vi.advanceTimersByTime(3000));
    expect(pet).toHaveAttribute('data-blink', 'true');
    act(() => vi.advanceTimersByTime(200));
    expect(pet).toHaveAttribute('data-blink', 'false');
  });

  it('breathes when idle, bobs faster when working, and hops when done', () => {
    const { rerender } = render(<DockPet pet={SCOUT} mood="idle" />);
    expect(screen.getByTestId('dock-body')).toHaveAttribute('data-motion', 'breathe');
    rerender(<DockPet pet={SCOUT} mood="working" />);
    expect(screen.getByTestId('dock-body')).toHaveAttribute('data-motion', 'busy');
    rerender(<DockPet pet={SCOUT} mood="done" />);
    expect(screen.getByTestId('dock-body')).toHaveAttribute('data-motion', 'hop');
  });
});
