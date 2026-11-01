/** Tests for Slider: native range (keyboard-operable), formatted value text. */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Slider } from './slider';

function setup(value = 5, onChange = vi.fn(), format?: (n: number) => string) {
  const formatProp = format === undefined ? {} : { format };
  render(
    <Slider
      id="s"
      label="Speed"
      value={value}
      min={0}
      max={10}
      step={1}
      onChange={onChange}
      {...formatProp}
    />,
  );
  return { input: screen.getByLabelText('Speed') as HTMLInputElement, onChange };
}

describe('Slider', () => {
  it('renders a native range with min, max, step and value', () => {
    const { input } = setup();
    expect(input.type).toBe('range');
    expect([input.min, input.max, input.step, input.value]).toEqual(['0', '10', '1', '5']);
  });

  it('reports the new number on change', () => {
    const { input, onChange } = setup();
    fireEvent.change(input, { target: { value: '7' } });
    expect(onChange).toHaveBeenCalledWith(7);
  });

  it('shows the value, formatted when asked', () => {
    setup(5, vi.fn(), (n) => `${n}x`);
    expect(screen.getByText('5x')).toBeInTheDocument();
  });

  it('sets --fill from where the value sits between min and max', () => {
    const { input } = setup(5);
    expect(input.style.getPropertyValue('--fill')).toBe('50%');
  });

  it('shows the plain number without a formatter', () => {
    setup(3);
    expect(screen.getByText('3')).toBeInTheDocument();
  });
});
