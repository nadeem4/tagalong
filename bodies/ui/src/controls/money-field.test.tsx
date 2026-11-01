/** Tests for MoneyField: $ prefix, stepper buttons, free typing, Enter commits, aria-invalid. */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MoneyField } from './money-field';

function setup(value: string, extra: Partial<Parameters<typeof MoneyField>[0]> = {}) {
  const onChange = vi.fn();
  render(<MoneyField id="m" label="Daily limit" value={value} onChange={onChange} {...extra} />);
  return { onChange, input: screen.getByLabelText('Daily limit') as HTMLInputElement };
}

describe('MoneyField', () => {
  it('hides the label visually but keeps it for the field when asked', () => {
    const { input } = setup('5', { hideLabel: true });
    expect(screen.getByText('Daily limit')).toHaveClass('tg-sr-only');
    expect(input).toBeInTheDocument();
  });

  it('plus and minus adjust by 1', () => {
    const { onChange } = setup('5');
    fireEvent.click(screen.getByRole('button', { name: 'Increase' }));
    expect(onChange).toHaveBeenLastCalledWith('6');
    fireEvent.click(screen.getByRole('button', { name: 'Decrease' }));
    expect(onChange).toHaveBeenLastCalledWith('4');
  });

  it('minus stops at 1 by default', () => {
    const { onChange } = setup('1.5');
    fireEvent.click(screen.getByRole('button', { name: 'Decrease' }));
    expect(onChange).toHaveBeenLastCalledWith('1');
    fireEvent.click(screen.getByRole('button', { name: 'Decrease' }));
    expect(onChange).toHaveBeenLastCalledWith('1');
  });

  it('plus from text that is not a number starts at 1', () => {
    const { onChange } = setup('abc');
    fireEvent.click(screen.getByRole('button', { name: 'Increase' }));
    expect(onChange).toHaveBeenLastCalledWith('1');
  });

  it('typing 2.5 keeps 2.5 text', () => {
    const { onChange, input } = setup('');
    fireEvent.change(input, { target: { value: '2.5' } });
    expect(onChange).toHaveBeenCalledWith('2.5');
  });

  it('Enter calls onCommit', () => {
    const onCommit = vi.fn();
    const { input } = setup('5', { onCommit });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('shows the dollar prefix', () => {
    setup('5');
    expect(screen.getByText('$')).toBeInTheDocument();
  });

  it('invalid sets aria-invalid', () => {
    const { input } = setup('-1', { invalid: true });
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });
});
