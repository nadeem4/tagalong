/** Tests for DockPet: Scout's mood on the live mascot, tags, marks and labels. */

import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { STATUS_WORDS } from './shapes';
import type { Pet } from './shapes';
import { DOCK_MOODS, DockPet } from './dock-pet';

// jsdom has no WebGL: the mascot itself is covered by its own package, so the face is a stub
// that shows which mood it was given.
vi.mock('./scout-face', () => ({
  ScoutFace: ({ mood }: { mood: string }) => <span data-testid="scout-face" data-mood={mood} />,
}));

// The gather overlay draws on a canvas: it has its own tests, so here it only shows its state.
vi.mock('./mascot/scout-gather', () => ({
  ScoutGather: ({ state, onDone }: { state: string; onDone?: () => void }) =>
    state === 'idle' ? null : (
      <button data-testid="scout-gather" data-state={state} onClick={onDone} />
    ),
}));

const SCOUT: Pet = {
  id: 'scout',
  name: 'Scout',
  avatar: '🦊',
};

describe('DockPet', () => {
  it.each(DOCK_MOODS)('draws the mascot in the %s mood', (mood) => {
    render(<DockPet pet={SCOUT} mood={mood} />);
    expect(screen.getByTestId('scout-face')).toHaveAttribute('data-mood', mood);
    expect(screen.getByRole('img')).toHaveAttribute('data-mood', mood);
  });

  it('says every mood in words', () => {
    for (const mood of DOCK_MOODS) {
      const { unmount } = render(<DockPet pet={SCOUT} mood={mood} />);
      expect(screen.getByRole('img').getAttribute('aria-label')).toMatch(/^Scout \S+/);
      unmount();
    }
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

  it('keeps the tag small, top right, so it stays clear of the mascot props', () => {
    render(<DockPet pet={SCOUT} mood="working" />);
    const tag = screen.getByTestId('dock-tag');
    expect(tag.style.fontSize).toBe('9px');
    expect(tag.style.top).toBe('4px');
    expect(tag.style.right).toBe('0px');
    expect(tag.style.padding).toBe('2px 3px');
  });

  it('shows that sight is paused in a mark and in words', () => {
    render(<DockPet pet={SCOUT} mood="idle" sightPaused />);
    expect(screen.getByTestId('paused-eye')).toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAccessibleName('Scout is idle, sight paused');
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

  it('reads speech heard on the mic as listening, not as Seeing', () => {
    const { rerender } = render(<DockPet pet={SCOUT} mood="listening" listening="hearing" />);
    expect(screen.queryByTestId('dock-tag')).toBeNull();
    expect(screen.getByRole('img')).toHaveAccessibleName('Scout is listening');
    // A real capture keeps its words, with or without the dot on.
    rerender(<DockPet pet={SCOUT} mood="listening" listening="on" />);
    expect(screen.getByTestId('dock-tag')).toHaveTextContent('Seeing');
    expect(screen.getByRole('img')).toHaveAccessibleName(
      'Scout is looking at your screen, listening',
    );
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
    const { rerender } = render(<DockPet pet={SCOUT} mood="idle" status={{ id: 'mic-busy' }} />);
    expect(screen.getByTestId('status-mark')).toHaveTextContent('Mic busy');
    expect(screen.getByRole('img')).toHaveAccessibleName(
      `Scout is idle, ${STATUS_WORDS['mic-busy'].detail}`,
    );
    rerender(<DockPet pet={SCOUT} mood="idle" status={null} />);
    expect(screen.queryByTestId('status-mark')).toBeNull();
    expect(screen.getByRole('img')).toHaveAccessibleName('Scout is idle');
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

  it('keeps every mark over the mascot: tag, paused, listening and status', () => {
    render(<DockPet pet={SCOUT} mood="working" listening="on" status={{ id: 'mic-busy' }} />);
    expect(screen.getByTestId('dock-tag')).toHaveTextContent('Working');
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

  describe('gather overlay', () => {
    it('brain-starting shows the gather overlay', () => {
      render(<DockPet pet={SCOUT} mood="idle" status={{ id: 'brain-starting' }} />);
      expect(screen.getByTestId('scout-gather')).toHaveAttribute('data-state', 'starting');
    });

    it('shows no overlay when the brain was never starting', () => {
      render(<DockPet pet={SCOUT} mood="idle" status={{ id: 'brain-offline' }} />);
      expect(screen.queryByTestId('scout-gather')).toBeNull();
    });

    it('going online hands over to the face', () => {
      const { rerender } = render(
        <DockPet pet={SCOUT} mood="idle" status={{ id: 'brain-starting' }} />,
      );
      rerender(<DockPet pet={SCOUT} mood="idle" status={null} />);
      expect(screen.getByTestId('scout-gather')).toHaveAttribute('data-state', 'ready');
      expect(screen.getByTestId('scout-face')).toBeInTheDocument();
    });

    it('keeps the face hidden until the gather is done, then shows it', () => {
      const { rerender } = render(
        <DockPet pet={SCOUT} mood="idle" status={{ id: 'brain-starting' }} />,
      );
      expect(screen.getByTestId('dock-face')).toHaveStyle({ opacity: '0' });
      rerender(<DockPet pet={SCOUT} mood="idle" status={null} />);
      expect(screen.getByTestId('dock-face')).toHaveStyle({ opacity: '0' });
      act(() => screen.getByTestId('scout-gather').click());
      expect(screen.queryByTestId('scout-gather')).toBeNull();
      expect(screen.getByTestId('dock-face')).toHaveStyle({ opacity: '1' });
    });

    it('a brain dying long after ready shows no overlay and keeps the face', () => {
      const { rerender } = render(
        <DockPet pet={SCOUT} mood="idle" status={{ id: 'brain-starting' }} />,
      );
      rerender(<DockPet pet={SCOUT} mood="idle" status={null} />);
      act(() => screen.getByTestId('scout-gather').click());
      rerender(<DockPet pet={SCOUT} mood="idle" status={{ id: 'brain-offline' }} />);
      expect(screen.queryByTestId('scout-gather')).toBeNull();
      expect(screen.getByTestId('dock-face')).toHaveStyle({ opacity: '1' });
    });

    it('starting, null, then offline before the hand-over ends shows no overlay', () => {
      const { rerender } = render(
        <DockPet pet={SCOUT} mood="idle" status={{ id: 'brain-starting' }} />,
      );
      rerender(<DockPet pet={SCOUT} mood="idle" status={null} />);
      rerender(<DockPet pet={SCOUT} mood="idle" status={{ id: 'brain-offline' }} />);
      expect(screen.queryByTestId('scout-gather')).toBeNull();
      expect(screen.getByTestId('dock-face')).toHaveStyle({ opacity: '1' });
    });

    it('offline after starting shows failed', () => {
      const { rerender } = render(
        <DockPet pet={SCOUT} mood="idle" status={{ id: 'brain-starting' }} />,
      );
      rerender(<DockPet pet={SCOUT} mood="idle" status={{ id: 'brain-offline' }} />);
      expect(screen.getByTestId('scout-gather')).toHaveAttribute('data-state', 'failed');
    });
  });
});
