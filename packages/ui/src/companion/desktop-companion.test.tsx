import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pet } from '@tagalong/protocol';
import { officeTokens } from '../office/tokens';
import { COMPANION_CSS, DesktopCompanion } from './desktop-companion';

const pet = (id: string, name: string): Pet => ({
  id,
  name,
  avatar: '🦊',
  model: 'm',
  providerId: 'fake',
  roleId: 'generalist',
  roleVersion: 1,
  toolGrants: {},
  replyStyle: 'text',
});

const scout = pet('scout', 'Scout');
const job = { label: 'GENERALIST', ink: officeTokens.roleInk.generalist };

function status(): HTMLElement {
  return screen.getByRole('img');
}

describe('DesktopCompanion', () => {
  it('is one button that opens the chat on the pet', () => {
    const onSelect = vi.fn();
    render(<DesktopCompanion pet={scout} job={job} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole('button', { name: 'Chat with Scout' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('draws the pet as a pixel sprite at a whole-number scale, never an emoji', () => {
    const { container } = render(<DesktopCompanion pet={scout} job={job} />);

    const sprite = screen.getByTestId('companion-sprite');
    expect(sprite.style.width).toBe('48px');
    expect(sprite.style.height).toBe('48px');
    expect(container.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('names the pet on a plate underlined in its role ink', () => {
    render(<DesktopCompanion pet={scout} job={job} />);

    const plate = screen.getByTestId('companion-plate');
    expect(plate).toHaveTextContent('Scout');
    expect(plate.style.borderBottomColor).not.toBe('');
    expect(plate.getAttribute('data-ink')).toBe(job.ink);
  });

  it('says it is at rest unless it is working', () => {
    render(<DesktopCompanion pet={scout} job={job} />);

    expect(status()).toHaveAccessibleName(/Scout is at rest/);
    expect(screen.queryByTestId('working-mark')).toBeNull();
  });

  it('bobs and shows a marker while working, and says so in words', () => {
    render(<DesktopCompanion pet={scout} job={job} working />);

    expect(status()).toHaveAccessibleName(/Scout is working/);
    expect(screen.getByTestId('working-mark')).toHaveAttribute('title', 'Working');
    expect(screen.getByTestId('companion-sprite').parentElement).toHaveClass('companion-bob');
  });

  it('keeps every state free of emoji and unicode glyph icons', () => {
    const { container } = render(
      <DesktopCompanion
        pet={scout}
        job={job}
        working
        recording
        watching
        alert
        needsYou
        captureCount={1}
        helpers={[pet('ink', 'Ink')]}
      />,
    );
    // The only text drawn is the name; the style sheet is not drawn.
    container.querySelector('style')?.remove();
    expect(container.textContent).toBe('Scout');
  });
});

describe('the still preference', () => {
  afterEach(() => localStorage.clear());

  it('stops the bob when the office is set to still', () => {
    localStorage.setItem('tagalong.office.still', '1');
    render(<DesktopCompanion pet={scout} job={job} working />);

    expect(screen.getByTestId('companion-sprite').parentElement).not.toHaveClass('companion-bob');
    expect(screen.getByTestId('working-mark')).toBeInTheDocument();
  });

  it('stops all motion under reduced motion', () => {
    expect(COMPANION_CSS).toMatch(/prefers-reduced-motion: reduce/);
    expect(COMPANION_CSS).toMatch(/steps\(1\)/);
  });
});

describe('the capture badge', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows for one second on every capture', () => {
    const { rerender } = render(<DesktopCompanion pet={scout} job={job} captureCount={0} />);
    expect(screen.queryByTestId('capture-badge')).toBeNull();

    rerender(<DesktopCompanion pet={scout} job={job} captureCount={1} />);
    expect(screen.getByTestId('capture-badge')).toHaveAttribute('title', 'Looked at your screen');
    expect(status()).toHaveAccessibleName(/looked at your screen/);

    act(() => vi.advanceTimersByTime(1000));
    expect(screen.queryByTestId('capture-badge')).toBeNull();

    rerender(<DesktopCompanion pet={scout} job={job} captureCount={2} />);
    expect(screen.getByTestId('capture-badge')).toBeInTheDocument();
  });

  it('never claims a look while sight is paused', () => {
    render(<DesktopCompanion pet={scout} job={job} sightPaused captureCount={1} />);
    expect(screen.queryByTestId('capture-badge')).toBeNull();
  });
});

describe('the sight eyes', () => {
  it('shows a grey eye with a slash while sight is paused, and says so', () => {
    render(<DesktopCompanion pet={scout} job={job} sightPaused />);

    const eye = screen.getByTestId('paused-eye');
    expect(eye.getAttribute('title')).toMatch(/paused/i);
    expect(status()).toHaveAccessibleName(/sight paused/);
  });

  it('shows a calm always-on eye when sight is Always', () => {
    render(<DesktopCompanion pet={scout} job={job} sightAlways />);

    expect(screen.getByTestId('always-eye').getAttribute('title')).toMatch(/always/i);
    expect(screen.queryByTestId('paused-eye')).toBeNull();
    expect(status()).toHaveAccessibleName(/sight always on/);
  });

  it('shows the paused eye, not the always eye, when Always is paused', () => {
    render(<DesktopCompanion pet={scout} job={job} sightAlways sightPaused />);

    expect(screen.getByTestId('paused-eye')).toBeInTheDocument();
    expect(screen.queryByTestId('always-eye')).toBeNull();
  });

  it('draws the paused and always eyes as different shapes', () => {
    const { rerender } = render(<DesktopCompanion pet={scout} job={job} sightAlways />);
    const always = screen.getByTestId('always-eye').innerHTML;
    rerender(<DesktopCompanion pet={scout} job={job} sightPaused />);
    expect(screen.getByTestId('paused-eye').innerHTML).not.toBe(always);
  });
});

describe('the recording dot', () => {
  it('shows while rolling memory records', () => {
    render(<DesktopCompanion pet={scout} job={job} recording />);
    expect(screen.getByTestId('recording-dot').getAttribute('title')).toMatch(/rolling memory/i);
    expect(status()).toHaveAccessibleName(/recording the screen/);
  });

  it('is absent while sight is paused', () => {
    render(<DesktopCompanion pet={scout} job={job} recording sightPaused />);
    expect(screen.queryByTestId('recording-dot')).toBeNull();
  });
});

describe('the watch cue', () => {
  it('shows a watching mark while a watch runs', () => {
    render(<DesktopCompanion pet={scout} job={job} watching />);
    expect(screen.getByTestId('watching-mark')).toBeInTheDocument();
    expect(status()).toHaveAccessibleName(/watching/);
  });

  it('shows an alert instead once a watch fired', () => {
    render(<DesktopCompanion pet={scout} job={job} watching alert />);
    expect(screen.getByTestId('watch-alert')).toBeInTheDocument();
    expect(screen.queryByTestId('watching-mark')).toBeNull();
    expect(status()).toHaveAccessibleName(/something happened/);
  });
});

describe('needs you', () => {
  it('raises the gold marker and says so', () => {
    render(<DesktopCompanion pet={scout} job={job} needsYou />);
    expect(screen.getByTestId('needs-you').getAttribute('title')).toMatch(/needs you/i);
    expect(status()).toHaveAccessibleName(/needs you/);
  });

  it('is absent by default', () => {
    render(<DesktopCompanion pet={scout} job={job} />);
    expect(screen.queryByTestId('needs-you')).toBeNull();
  });
});

describe('helpers', () => {
  it('shows each helper as a tiny sprite badge named in its tooltip', () => {
    render(
      <DesktopCompanion pet={scout} job={job} helpers={[pet('ink', 'Ink'), pet('bolt', 'Bolt')]} />,
    );

    const badges = screen.getAllByTestId('helper-badge');
    expect(badges.map((badge) => badge.getAttribute('title'))).toEqual([
      'Ink is helping',
      'Bolt is helping',
    ]);
    expect(within(badges[0]!).getByTestId('helper-sprite').style.width).toBe('16px');
    expect(status()).toHaveAccessibleName(/Ink and Bolt helping/);
  });

  it('shows none when nobody is helping', () => {
    render(<DesktopCompanion pet={scout} job={job} />);
    expect(screen.queryByTestId('helper-badge')).toBeNull();
  });
});
