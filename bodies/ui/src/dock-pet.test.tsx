/** Tests for DockPet: Bean's clip per mood, tags, marks, blinking and reduced motion. */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Pet } from '@tagalong/protocol';
import {
  DockPet as RealDockPet,
  type BeanFigure,
  type DockMood,
  type DockPetProps,
} from './dock-pet';

const SCOUT: Pet = {
  id: 'scout',
  name: 'Scout',
  avatar: '🦊',
  roleId: 'companion',
  model: 'haiku',
  providerId: 'claude-code',
};

const MOODS: readonly DockMood[] = [
  'idle',
  'listening',
  'reading',
  'thinking',
  'working',
  'dozing',
];

/** A fake strip: a URL per clip, with the real clips' shape. */
const clip = (name: string, frames: number, loop = true) => ({
  src: `fake://${name}.webp`,
  frames,
  fps: 12,
  loop,
});
const FIGURE: BeanFigure = {
  idle: clip('idle', 36),
  listening: clip('listening', 36),
  reading: clip('reading', 36),
  thinking: clip('thinking', 36),
  working: clip('working', 24),
  dozing: clip('dozing', 48),
  'idle-blink': clip('idle-blink', 2, false),
  'listening-blink': clip('listening-blink', 2, false),
};

/** DockPet with the fake figure, so each test names only what it is about. */
function DockPet(props: Omit<DockPetProps, 'figure'>) {
  return <RealDockPet figure={FIGURE} {...props} />;
}

/** The mood's own clip (a blink lays a second one over it). */
function moodClip(): HTMLElement {
  return screen.getAllByTestId('bean-clip')[0]!;
}

/** The mood's loop comes back round to frame 0. */
function loopRestarts(): void {
  act(() => {
    fireEvent.animationIteration(moodClip());
  });
}

function stubReducedMotion(): void {
  // jsdom has no matchMedia of its own.
  vi.stubGlobal(
    'matchMedia',
    (query: string) => ({ matches: query.includes('reduce'), media: query }) as never,
  );
}

describe('DockPet', () => {
  it.each(MOODS)('draws Bean in its own clip while %s', (mood) => {
    render(<DockPet pet={SCOUT} mood={mood} />);
    expect(moodClip()).toHaveAttribute('data-clip', mood);
    expect(moodClip().style.backgroundImage).toBe(`url("fake://${mood}.webp")`);
    expect(screen.getByRole('img')).toHaveAttribute('data-mood', mood);
  });

  it('is a fixed 96 px box with no padding', () => {
    render(<DockPet pet={SCOUT} mood="idle" />);
    const pet = screen.getByRole('img');
    expect(pet.style.width).toBe('96px');
    expect(pet.style.height).toBe('96px');
    expect(pet.style.padding).toBe('0px');
  });

  it('draws the pet and says what it is doing, with a tag for anything but idle', () => {
    const { rerender } = render(<DockPet pet={SCOUT} mood="idle" />);
    expect(screen.getByRole('img')).toHaveAccessibleName('Scout is idle');
    expect(screen.queryByTestId('dock-tag')).toBeNull();

    rerender(<DockPet pet={SCOUT} mood="listening" />);
    expect(screen.getByTestId('dock-tag')).toHaveTextContent('Seeing');
    rerender(<DockPet pet={SCOUT} mood="working" />);
    expect(screen.getByTestId('dock-tag')).toHaveTextContent('Working');
  });

  it('tags working Working, and says which work in the label', () => {
    render(<DockPet pet={SCOUT} mood="working" />);
    expect(screen.getByTestId('dock-tag')).toHaveTextContent('Working');
    expect(screen.getByRole('img')).toHaveAccessibleName('Scout is working on a job of its own');
  });

  it.each([
    ['thinking', 'Scout is thinking'],
    ['reading', 'Scout is reading your screen'],
  ] as const)('gives %s no tag, as its sign and the bubble say it', (mood, label) => {
    render(<DockPet pet={SCOUT} mood={mood} />);
    expect(screen.queryByTestId('dock-tag')).toBeNull();
    expect(screen.getByRole('img')).toHaveAccessibleName(label);
  });

  it('keeps the tag small, top right, so it sits beside Bean’s sign rather than on it', () => {
    render(<DockPet pet={SCOUT} mood="working" />);
    const tag = screen.getByTestId('dock-tag');
    expect(tag.style.fontSize).toBe('9px');
    expect(tag.style.top).toBe('4px');
    expect(tag.style.right).toBe('0px');
    expect(tag.style.padding).toBe('1px 3px');
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

  it('shows that it hears speech, and the follow-up window, on the listening dot', () => {
    const { rerender } = render(<DockPet pet={SCOUT} mood="idle" listening="hearing" />);
    expect(screen.getByTestId('listening-mark')).toHaveAttribute('data-state', 'hearing');
    expect(screen.getByRole('img')).toHaveAccessibleName('Scout is idle, listening');
    rerender(<DockPet pet={SCOUT} mood="idle" listening="follow-up" />);
    expect(screen.getByTestId('listening-mark')).toHaveAttribute('data-state', 'follow-up');
    expect(screen.getByTestId('listening-mark')).toHaveAttribute(
      'title',
      'Listening for your reply, no name needed.',
    );
    expect(screen.getByRole('img')).toHaveAccessibleName('Scout is idle, listening for your reply');
  });

  it('names what the listening dot means in its tooltip', () => {
    const { rerender } = render(<DockPet pet={SCOUT} mood="idle" listening="on" />);
    expect(screen.getByTestId('listening-mark')).toHaveAttribute(
      'title',
      'Always listening is on. Say “Scout, stop” to switch it off.',
    );
    rerender(<DockPet pet={SCOUT} mood="idle" listening="paused" />);
    expect(screen.getByTestId('listening-mark')).toHaveAttribute(
      'title',
      'Always listening is paused for a call or a full-screen window.',
    );
  });

  it('shows the top status mark as a tag, named in its label', () => {
    const { rerender } = render(
      <DockPet pet={SCOUT} mood="idle" status={{ id: 'brain-signed-out' }} />,
    );
    expect(screen.getByTestId('status-mark')).toHaveTextContent('Signed out');
    expect(screen.getByRole('img')).toHaveAccessibleName(
      'Scout is idle, Can’t think: signed out of Claude.',
    );
    rerender(<DockPet pet={SCOUT} mood="idle" status={null} />);
    expect(screen.queryByTestId('status-mark')).toBeNull();
    expect(screen.getByRole('img')).toHaveAccessibleName('Scout is idle');
  });
});

describe('a living pet', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each(['idle', 'listening'] as const)(
    'blinks now and then while %s, from frame 0 of the loop, for two frames',
    (mood) => {
      vi.useFakeTimers();
      render(<DockPet pet={SCOUT} mood={mood} blinkEveryMs={3000} />);
      const pet = screen.getByRole('img');
      expect(pet).toHaveAttribute('data-blink', 'false');
      act(() => vi.advanceTimersByTime(3000));
      // Time to blink, but it waits for the loop to come round so nothing jumps.
      expect(pet).toHaveAttribute('data-blink', 'false');
      loopRestarts();
      expect(pet).toHaveAttribute('data-blink', 'true');
      expect(screen.getAllByTestId('bean-clip')[1]).toHaveAttribute('data-clip', `${mood}-blink`);
      // The mood's own clip keeps running underneath, hidden, so it never restarts.
      expect(moodClip()).toHaveAttribute('data-clip', mood);
      expect(moodClip().style.visibility).toBe('hidden');
      act(() => vi.advanceTimersByTime(Math.ceil((2 / 12) * 1000)));
      expect(pet).toHaveAttribute('data-blink', 'false');
      expect(screen.getAllByTestId('bean-clip')).toHaveLength(1);
      expect(moodClip().style.visibility).toBe('');
    },
  );

  it('does not blink at a loop that comes round before it is time', () => {
    vi.useFakeTimers();
    render(<DockPet pet={SCOUT} mood="idle" blinkEveryMs={3000} />);
    loopRestarts();
    expect(screen.getByRole('img')).toHaveAttribute('data-blink', 'false');
  });

  it('blinks again only after the next wait', () => {
    vi.useFakeTimers();
    render(<DockPet pet={SCOUT} mood="idle" blinkEveryMs={3000} />);
    const pet = screen.getByRole('img');
    act(() => vi.advanceTimersByTime(3000));
    loopRestarts();
    act(() => vi.advanceTimersByTime(200));
    expect(pet).toHaveAttribute('data-blink', 'false');
    loopRestarts();
    expect(pet).toHaveAttribute('data-blink', 'false');
    act(() => vi.advanceTimersByTime(3000));
    loopRestarts();
    expect(pet).toHaveAttribute('data-blink', 'true');
  });

  it.each(['reading', 'thinking', 'working', 'dozing'] as const)(
    'never blinks while %s',
    (mood) => {
      vi.useFakeTimers();
      render(<DockPet pet={SCOUT} mood={mood} blinkEveryMs={3000} />);
      act(() => vi.advanceTimersByTime(3000));
      loopRestarts();
      expect(screen.getByRole('img')).toHaveAttribute('data-blink', 'false');
      expect(screen.getAllByTestId('bean-clip')).toHaveLength(1);
    },
  );

  it('stops a waiting blink when the mood changes to one that does not blink', () => {
    vi.useFakeTimers();
    const { rerender } = render(<DockPet pet={SCOUT} mood="idle" blinkEveryMs={3000} />);
    act(() => vi.advanceTimersByTime(3000));
    rerender(<DockPet pet={SCOUT} mood="working" blinkEveryMs={3000} />);
    loopRestarts();
    expect(screen.getByRole('img')).toHaveAttribute('data-blink', 'false');
  });

  it('does not blink when the system asks for reduced motion', () => {
    vi.useFakeTimers();
    stubReducedMotion();
    render(<DockPet pet={SCOUT} mood="idle" blinkEveryMs={3000} />);
    act(() => vi.advanceTimersByTime(3000));
    loopRestarts();
    expect(screen.getByRole('img')).toHaveAttribute('data-blink', 'false');
  });

  it.each(MOODS)('shows a still of Bean under reduced motion while %s', (mood) => {
    stubReducedMotion();
    render(<DockPet pet={SCOUT} mood={mood} />);
    expect(moodClip()).toHaveAttribute('data-clip', mood);
    expect(moodClip().style.animation).toBe('');
  });

  it('keeps a reduced-motion backstop for the clips and the listening dot', () => {
    render(<DockPet pet={SCOUT} mood="idle" />);
    const css = [...document.querySelectorAll('style')].map((s) => s.textContent).join('\n');
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{[^}]*\[data-testid='bean-clip'\]/);
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{[^}]*\.dock-pet__listening/);
  });
});

describe('moods', () => {
  it('react without a tag, and say the mood in the label', () => {
    render(<DockPet pet={SCOUT} mood="dozing" />);
    expect(screen.queryByTestId('dock-tag')).toBeNull();
    expect(screen.getByRole('img')).toHaveAccessibleName('Scout is dozing');
  });

  it.each(['dozing'] as const)('keeps the listening mark and its words while %s', (mood) => {
    const { rerender } = render(<DockPet pet={SCOUT} mood={mood} listening="on" />);
    expect(screen.getByTestId('listening-mark')).toHaveAttribute('data-state', 'on');
    expect(screen.getByRole('img').getAttribute('aria-label')).toMatch(/, listening$/);
    rerender(<DockPet pet={SCOUT} mood={mood} listening="paused" />);
    expect(screen.getByTestId('listening-mark')).toHaveAttribute('data-state', 'paused');
    expect(screen.getByRole('img').getAttribute('aria-label')).toMatch(/, listening paused$/);
  });

  it('keeps every mark over Bean: tag, paused, listening and status', () => {
    render(
      <DockPet
        pet={SCOUT}
        mood="working"
        recording
        listening="on"
        status={{ id: 'brain-signed-out' }}
      />,
    );
    expect(screen.getByTestId('dock-tag')).toHaveTextContent('Working');
    expect(screen.getByTestId('recording-dot')).toBeInTheDocument();
    expect(screen.getByTestId('listening-mark')).toBeInTheDocument();
    expect(screen.getByTestId('status-mark')).toBeInTheDocument();
  });

  it('gives the top to the Paused mark while sight is paused, and keeps the mood in words', () => {
    render(<DockPet pet={SCOUT} mood="working" sightPaused />);
    expect(screen.getByTestId('paused-eye')).toBeInTheDocument();
    // The two would overlap at the top of the 96 px window; the pose still shows the work.
    expect(screen.queryByTestId('dock-tag')).toBeNull();
    expect(screen.getByRole('img')).toHaveAccessibleName(
      'Scout is working on a job of its own, sight paused',
    );
  });
});
