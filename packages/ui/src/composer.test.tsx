import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Composer } from './composer';

function type(text: string): void {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: text } });
}

describe('Composer', () => {
  it('sends the typed text on the send button and clears the input', () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} disabled={false} />);

    type('Explain this');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(onSend).toHaveBeenCalledWith('Explain this');
    expect(screen.getByRole('textbox')).toHaveValue('');
  });

  it('sends on Enter but keeps Shift+Enter for a newline', () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} disabled={false} />);

    type('Explain this');
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(onSend).toHaveBeenCalledWith('Explain this');
  });

  it('never sends whitespace', () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} disabled={false} />);

    type('   ');
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });

    expect(onSend).not.toHaveBeenCalled();
  });

  it('only promises sight in the placeholder when something is attached', () => {
    const { rerender } = render(<Composer onSend={vi.fn()} disabled={false} />);

    expect(screen.getByRole('textbox')).toHaveAttribute(
      'placeholder',
      'Ask anything — or attach what you are looking at',
    );

    rerender(<Composer onSend={vi.fn()} disabled={false} seeing />);

    expect(screen.getByRole('textbox')).toHaveAttribute(
      'placeholder',
      'Ask about what is on screen',
    );
  });

  it('is inert while a turn is streaming', () => {
    const onSend = vi.fn();
    const { rerender } = render(<Composer onSend={onSend} disabled={false} />);
    type('Explain this');

    rerender(<Composer onSend={onSend} disabled />);

    expect(screen.getByRole('textbox')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
  });
});
