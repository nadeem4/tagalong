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

  it('shows that Scout is listening the whole time it is, and when that is paused', () => {
    const { rerender } = render(<DockPet pet={SCOUT} mood="idle" listening="on" />);
    expect(screen.getByTestId('listening-mark')).toHaveAttribute('data-state', 'on');
    expect(screen.getByRole('img')).toHaveAccessibleName('Scout is idle, listening');
    rerender(<DockPet pet={SCOUT} mood="idle" listening="paused" />);
    expect(screen.getByTestId('listening-mark')).toHaveAttribute('data-state', 'paused');
    expect(screen.getByRole('img')).toHaveAccessibleName('Scout is idle, listening paused');
    rerender(<DockPet pet={SCOUT} mood="idle" />);
    expect(screen.queryByTestId('listening-mark')).toBeNull();
    expect(screen.getByRole('img')).toHaveAccessibleName('Scout is idle');
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

  it('does not blink when the system asks for reduced motion', () => {
    vi.useFakeTimers();
    // jsdom has no matchMedia of its own.
    vi.stubGlobal(
      'matchMedia',
      (query: string) => ({ matches: query.includes('reduce'), media: query }) as never,
    );
    try {
      render(<DockPet pet={SCOUT} mood="idle" blinkEveryMs={3000} />);
      act(() => vi.advanceTimersByTime(3000));
      expect(screen.getByRole('img')).toHaveAttribute('data-blink', 'false');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('breathes when idle, bobs faster when working, and hops when done', () => {
    const { rerender } = render(<DockPet pet={SCOUT} mood="idle" />);
    expect(screen.getByTestId('dock-body')).toHaveAttribute('data-motion', 'breathe');
    rerender(<DockPet pet={SCOUT} mood="working" />);
    expect(screen.getByTestId('dock-body')).toHaveAttribute('data-motion', 'busy');
    rerender(<DockPet pet={SCOUT} mood="done" />);
    expect(screen.getByTestId('dock-body')).toHaveAttribute('data-motion', 'hop');
  });

  it('breathes slowly while dozing, shakes once at a wince, and hops twice to cheer', () => {
    const { rerender } = render(<DockPet pet={SCOUT} mood="dozing" />);
    expect(screen.getByTestId('dock-body')).toHaveAttribute('data-motion', 'doze');
    rerender(<DockPet pet={SCOUT} mood="wince" />);
    expect(screen.getByTestId('dock-body')).toHaveAttribute('data-motion', 'shake');
    rerender(<DockPet pet={SCOUT} mood="cheer" />);
    expect(screen.getByTestId('dock-body')).toHaveAttribute('data-motion', 'cheer');
  });

  it('breathes slowly while tired, and says so with no tag', () => {
    render(<DockPet pet={SCOUT} mood="tired" />);
    expect(screen.getByTestId('dock-body')).toHaveAttribute('data-motion', 'doze');
    expect(screen.queryByTestId('dock-tag')).toBeNull();
    expect(screen.getByRole('img')).toHaveAccessibleName('Scout looks tired');
  });

  it.each(['dozing', 'wince', 'cheer', 'tired'] as const)('never blinks while %s', (mood) => {
    vi.useFakeTimers();
    render(<DockPet pet={SCOUT} mood={mood} blinkEveryMs={3000} />);
    act(() => vi.advanceTimersByTime(3000));
    expect(screen.getByRole('img')).toHaveAttribute('data-blink', 'false');
  });
});

describe('moods', () => {
  it('react without a tag, and say the mood in the label', () => {
    const { rerender } = render(<DockPet pet={SCOUT} mood="dozing" />);
    expect(screen.queryByTestId('dock-tag')).toBeNull();
    expect(screen.getByRole('img')).toHaveAccessibleName('Scout is dozing');
    rerender(<DockPet pet={SCOUT} mood="wince" />);
    expect(screen.queryByTestId('dock-tag')).toBeNull();
    expect(screen.getByRole('img')).toHaveAccessibleName('Scout winces');
    rerender(<DockPet pet={SCOUT} mood="cheer" />);
    expect(screen.queryByTestId('dock-tag')).toBeNull();
    expect(screen.getByRole('img')).toHaveAccessibleName('Scout is cheering');
  });

  it.each(['dozing', 'wince', 'cheer'] as const)(
    'keeps the listening mark and its words while %s',
    (mood) => {
      const { rerender } = render(<DockPet pet={SCOUT} mood={mood} listening="on" />);
      expect(screen.getByTestId('listening-mark')).toHaveAttribute('data-state', 'on');
      expect(screen.getByRole('img').getAttribute('aria-label')).toMatch(/, listening$/);
      rerender(<DockPet pet={SCOUT} mood={mood} listening="paused" />);
      expect(screen.getByTestId('listening-mark')).toHaveAttribute('data-state', 'paused');
      expect(screen.getByRole('img').getAttribute('aria-label')).toMatch(/, listening paused$/);
    },
  );

  it('stops every motion under reduced motion, the new ones included', () => {
    render(<DockPet pet={SCOUT} mood="cheer" />);
    const css = document.querySelector('style')?.textContent ?? '';
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*\.dock-body\b/);
    // The new motions are all on .dock-body, so the one rule stops them too.
    for (const motion of ['doze', 'shake', 'cheer']) {
      expect(css).toContain(`.dock-body[data-motion='${motion}']`);
    }
  });
});
