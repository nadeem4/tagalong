/** Tests for StatusMark: the tag on Scout and the row in the bubble. */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { STATUS_WORDS } from './shapes';
import { StatusMark } from './status-mark';

describe('StatusMark, the tag on Scout', () => {
  it('shows the short tag, with the sentence as its tooltip', () => {
    render(<StatusMark mark={{ id: 'mic-busy' }} variant="tag" />);
    const tag = screen.getByTestId('status-mark');
    expect(tag).toHaveTextContent('Mic busy');
    expect(tag).toHaveAttribute('title', STATUS_WORDS['mic-busy'].detail);
    expect(tag).toHaveAttribute('data-id', 'mic-busy');
    expect(tag).toHaveAttribute('data-tone', 'warn');
    // Scout itself is the button: the tag is not one.
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows a hint in the muted tone', () => {
    render(<StatusMark mark={{ id: 'listening-on' }} variant="tag" />);
    const tag = screen.getByTestId('status-mark');
    expect(tag).toHaveTextContent('Listening');
    expect(tag).toHaveAttribute('data-tone', 'muted');
  });

  it('shows the speech models download with its percent', () => {
    render(<StatusMark mark={{ id: 'ears-loading', percent: 42 }} variant="tag" />);
    expect(screen.getByTestId('status-mark')).toHaveTextContent('Ears 42%');
    expect(screen.getByTestId('status-mark')).toHaveAttribute('data-tone', 'muted');
  });

  it('sits above the listening dot in the bottom corner, not on it', () => {
    render(<StatusMark mark={{ id: 'mic-failed' }} variant="tag" />);
    // The dot is 8 px, 8 px from the bottom of the 96 px dock: the tag starts above it.
    expect(screen.getByTestId('status-mark').style.bottom).toBe('18px');
  });
});

describe('StatusMark, the row in the bubble', () => {
  it('shows the sentence as a status, with Fix it when there is a fix', () => {
    const onFix = vi.fn();
    render(<StatusMark mark={{ id: 'mic-failed' }} variant="row" onFix={onFix} />);
    expect(screen.getByRole('status')).toHaveTextContent('The microphone could not be opened.');
    expect(screen.getByRole('status')).toHaveAttribute('data-tone', 'warn');
    fireEvent.click(screen.getByRole('button', { name: 'Fix it' }));
    expect(onFix).toHaveBeenCalledExactlyOnceWith('voice');
  });

  it('says Add key, in Scout’s own app words, when the brain has no key', () => {
    const onFix = vi.fn();
    render(<StatusMark mark={{ id: 'no-key' }} variant="row" onFix={onFix} />);
    expect(screen.getByRole('status')).toHaveTextContent('Add your Anthropic key to start.');
    fireEvent.click(screen.getByRole('button', { name: 'Add key' }));
    expect(onFix).toHaveBeenCalledWith('key');
  });

  it('has no Fix it for a hint, or for a problem with no handler', () => {
    const { unmount } = render(
      <StatusMark mark={{ id: 'listening-on' }} variant="row" onFix={vi.fn()} />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Always listening is on.');
    expect(screen.queryByRole('button')).toBeNull();
    unmount();
    render(<StatusMark mark={{ id: 'mic-busy' }} variant="row" />);
    expect(screen.getByRole('status')).toHaveTextContent('Another app is using the microphone.');
    expect(screen.queryByRole('button')).toBeNull();
  });
});
