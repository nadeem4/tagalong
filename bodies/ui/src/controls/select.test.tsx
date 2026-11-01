/** Tests for Select: labelled, reports the option value, native keyboard behaviour. */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Select } from './select';

const OPTIONS = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
];

describe('Select', () => {
  it('is labelled by its label', () => {
    render(<Select id="s" label="Voice" value="a" onChange={() => {}} options={OPTIONS} />);
    expect(screen.getByLabelText('Voice')).toBeInstanceOf(HTMLSelectElement);
  });

  it('onChange gets the option value', () => {
    const onChange = vi.fn();
    render(<Select id="s" label="Voice" value="a" onChange={onChange} options={OPTIONS} />);
    fireEvent.change(screen.getByLabelText('Voice'), { target: { value: 'b' } });
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('renders a native select with the chosen value and its options', () => {
    render(<Select id="s" label="Voice" value="b" onChange={() => {}} options={OPTIONS} />);
    const select = screen.getByLabelText('Voice') as HTMLSelectElement;
    expect(select.value).toBe('b');
    expect(select.options).toHaveLength(2);
  });

  it('marks the select invalid and described when asked', () => {
    render(
      <Select
        id="s"
        label="Voice"
        value="a"
        onChange={() => {}}
        options={OPTIONS}
        invalid
        describedBy="err"
      />,
    );
    const select = screen.getByLabelText('Voice');
    expect(select).toHaveAttribute('aria-invalid', 'true');
    expect(select).toHaveAttribute('aria-describedby', 'err');
  });

  it('has no aria-invalid by default', () => {
    render(<Select id="s" label="Voice" value="a" onChange={() => {}} options={OPTIONS} />);
    expect(screen.getByLabelText('Voice')).not.toHaveAttribute('aria-invalid');
  });

  it('disabled disables the select', () => {
    render(
      <Select id="s" label="Voice" value="a" onChange={() => {}} options={OPTIONS} disabled />,
    );
    expect(screen.getByLabelText('Voice')).toBeDisabled();
  });
});
