/** Tests for ThreeWay: radio group semantics, one change per press, disabled options, arrow keys. */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ThreeWay } from './three-way';

const OPTIONS = [
  { value: 'off', label: 'Off' },
  { value: 'ask', label: 'Ask' },
  { value: 'auto', label: 'Auto' },
];

describe('ThreeWay', () => {
  it('is a radio group with one checked radio', () => {
    render(<ThreeWay label="recall" value="ask" options={OPTIONS} onChange={() => {}} />);
    const group = screen.getByRole('radiogroup', { name: 'recall' });
    expect(group).toHaveClass('tg-three');
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    expect(screen.getByRole('radio', { name: 'Ask' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Off' })).toHaveAttribute('aria-checked', 'false');
  });

  it('only the checked radio is in the tab order', () => {
    render(<ThreeWay label="x" value="ask" options={OPTIONS} onChange={() => {}} />);
    expect(screen.getByRole('radio', { name: 'Ask' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('radio', { name: 'Auto' })).toHaveAttribute('tabindex', '-1');
  });

  it('reports the pressed option once, and nothing for the one already chosen', () => {
    const onChange = vi.fn();
    render(<ThreeWay label="x" value="ask" options={OPTIONS} onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Ask' }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('radio', { name: 'Off' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('off');
  });

  it('does not report a disabled option', () => {
    const onChange = vi.fn();
    const options = [OPTIONS[0]!, OPTIONS[1]!, { ...OPTIONS[2]!, disabled: true }];
    render(<ThreeWay label="x" value="ask" options={options} onChange={onChange} />);
    const auto = screen.getByRole('radio', { name: 'Auto' });
    expect(auto).toBeDisabled();
    fireEvent.click(auto);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('arrow keys skip a disabled option and wrap round, as native radios do', () => {
    const onChange = vi.fn();
    const options = [OPTIONS[0]!, { ...OPTIONS[1]!, disabled: true }, OPTIONS[2]!];
    const { rerender } = render(
      <ThreeWay label="x" value="off" options={options} onChange={onChange} />,
    );
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Off' }), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('auto');
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Off' }), { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith('auto'); // wraps from the first to the last
    rerender(<ThreeWay label="x" value="auto" options={options} onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Auto' }), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('off'); // wraps from the last to the first
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it('keeps one tab stop on an enabled option when the chosen one is disabled or missing', () => {
    const options = [OPTIONS[0]!, OPTIONS[1]!, { ...OPTIONS[2]!, disabled: true }];
    const { rerender } = render(
      <ThreeWay label="x" value="auto" options={options} onChange={() => {}} />,
    );
    expect(screen.getByRole('radio', { name: 'Off' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('radio', { name: 'Auto' })).toHaveAttribute('tabindex', '-1');
    rerender(<ThreeWay label="x" value="nothing" options={options} onChange={() => {}} />);
    expect(screen.getByRole('radio', { name: 'Off' })).toHaveAttribute('tabindex', '0');
    expect(screen.getAllByRole('radio').filter((r) => r.tabIndex === 0)).toHaveLength(1);
  });

  it('is named by visible text when given its id', () => {
    render(
      <>
        <span id="name">move_window</span>
        <ThreeWay labelledBy="name" value="ask" options={OPTIONS} onChange={() => {}} />
      </>,
    );
    expect(screen.getByRole('radiogroup', { name: 'move_window' })).toBeInTheDocument();
  });

  it('can be described by a note elsewhere on the page', () => {
    render(
      <ThreeWay label="x" value="ask" options={OPTIONS} onChange={() => {}} describedBy="note" />,
    );
    expect(screen.getByRole('radiogroup')).toHaveAttribute('aria-describedby', 'note');
  });
});
