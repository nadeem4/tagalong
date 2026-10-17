/** Tests for StatusMark: the tag on Scout and the row in the bubble. */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StatusMark } from './status-mark';

describe('StatusMark, the tag on Scout', () => {
  it('shows the short tag, with the sentence as its tooltip', () => {
    render(<StatusMark mark={{ id: 'brain-signed-out' }} variant="tag" />);
    const tag = screen.getByTestId('status-mark');
    expect(tag).toHaveTextContent('Signed out');
    expect(tag).toHaveAttribute('title', 'Can’t think: signed out of Claude.');
    expect(tag).toHaveAttribute('data-id', 'brain-signed-out');
    expect(tag).toHaveAttribute('data-tone', 'warn');
    // Scout itself is the button: the tag is not one.
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows a download’s percent and a mark’s own sentence', () => {
    render(
      <StatusMark
        mark={{ id: 'ears-loading', percent: 40, detail: 'Downloading 43 MB.' }}
        variant="tag"
      />,
    );
    const tag = screen.getByTestId('status-mark');
    expect(tag).toHaveTextContent('Ears 40%');
    expect(tag).toHaveAttribute('title', 'Downloading 43 MB.');
    expect(tag).toHaveAttribute('data-tone', 'muted');
  });
});

describe('StatusMark, the row in the bubble', () => {
  it('shows the sentence as a status, with Fix it when there is a fix', () => {
    const onFix = vi.fn();
    render(<StatusMark mark={{ id: 'brain-no-key' }} variant="row" onFix={onFix} />);
    expect(screen.getByRole('status')).toHaveTextContent('Can’t think: no API key.');
    fireEvent.click(screen.getByRole('button', { name: 'Fix it' }));
    expect(onFix).toHaveBeenCalledWith('brain');
  });

  it('has no Fix it for a hint, or with no handler', () => {
    const { unmount } = render(<StatusMark mark={{ id: 'listening-on' }} variant="row" />);
    expect(screen.getByRole('status')).toHaveTextContent('Always listening is on.');
    expect(screen.queryByRole('button')).toBeNull();
    unmount();
    render(<StatusMark mark={{ id: 'declined' }} variant="row" onFix={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Declined.');
    expect(screen.queryByRole('button')).toBeNull();
  });
});
