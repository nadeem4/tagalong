/** Tests for BeanClip: one pre-rendered strip of Bean frames, stepped through with CSS. */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BeanClip } from './bean-clip';

const LOOP = { src: 'fake://idle.webp', frames: 36, fps: 12, loop: true };
const ONCE = { src: 'fake://cheer.webp', frames: 12, fps: 12, loop: false };

function clipStyle(): CSSStyleDeclaration {
  return screen.getByTestId('bean-clip').style;
}

function keyframes(): string {
  return document.querySelector('style')?.textContent ?? '';
}

describe('BeanClip', () => {
  it('draws the strip as a 96 px frame, scaled so one frame fills it', () => {
    render(<BeanClip clip={LOOP} />);
    const style = clipStyle();
    expect(style.backgroundImage).toBe('url("fake://idle.webp")');
    expect(style.backgroundSize).toBe('3456px 96px');
    expect(style.width).toBe('96px');
    expect(style.height).toBe('96px');
  });

  it('steps through a loop forever, at the clip fps', () => {
    render(<BeanClip clip={LOOP} />);
    const animation = clipStyle().animation;
    expect(animation).toContain('3s');
    expect(animation).toContain('steps(36)');
    expect(animation).toContain('infinite');
    // The loop runs to one frame past the last, so steps(36) lands on every frame once.
    expect(keyframes()).toContain('-3456px');
  });

  it('plays a one-shot once and holds its last frame', () => {
    render(<BeanClip clip={ONCE} />);
    const animation = clipStyle().animation;
    expect(animation).toContain('1s');
    expect(animation).toContain('steps(11)');
    expect(animation).toContain('forwards');
    expect(animation).not.toContain('infinite');
    expect(keyframes()).toContain('-1056px');
  });

  it('stands still on frame 0 of a loop', () => {
    render(<BeanClip clip={LOOP} still />);
    expect(clipStyle().animation).toBe('');
    expect(clipStyle().backgroundPosition).toBe('0px 0px');
  });

  it('stands still on the held last frame of a one-shot', () => {
    render(<BeanClip clip={ONCE} still />);
    expect(clipStyle().animation).toBe('');
    expect(clipStyle().backgroundPosition).toBe('-1056px 0px');
  });

  it('names the clip it draws, and hides itself from assistive tech', () => {
    render(<BeanClip clip={LOOP} name="idle" />);
    expect(screen.getByTestId('bean-clip')).toHaveAttribute('data-clip', 'idle');
    expect(screen.getByTestId('bean-clip')).toHaveAttribute('aria-hidden', 'true');
  });
});
