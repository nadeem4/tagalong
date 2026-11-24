/** Tests for RunsOn: the current choice in words, the four choices, Try first under Both, and the locked control. */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RunsOn } from './runs-on';

const open = (name = 'Gmail') =>
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^Runs on.*${name}`) }));

function setup(props: Partial<Parameters<typeof RunsOn>[0]> = {}) {
  const onChange = vi.fn();
  render(
    <RunsOn
      name="Gmail"
      machine="mini-pc"
      choice="brain"
      tryFirst="body"
      onChange={onChange}
      {...props}
    />,
  );
  return onChange;
}

describe('RunsOn', () => {
  it('says the current choice in words, using the brain machine name', () => {
    setup();
    expect(screen.getByRole('button', { name: /Runs on.*Gmail.*mini-pc/ })).toBeInTheDocument();
  });

  it('offers the machine, This PC, Both and Ask me each time, and chooses one', () => {
    const onChange = setup();
    open();
    for (const label of ['mini-pc', 'This PC', 'Both', 'Ask me each time']) {
      expect(screen.getByRole('button', { name: new RegExp(`^${label}`) })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole('button', { name: /^This PC/ }));
    expect(onChange).toHaveBeenCalledWith('body', 'body');
  });

  it('asks which to try first once Both is chosen', () => {
    const onChange = setup({ choice: 'both', tryFirst: 'body' });
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Try mini-pc first' }));
    expect(onChange).toHaveBeenCalledWith('both', 'brain');
  });

  it('shows no Try first for the other choices', () => {
    setup();
    open();
    expect(screen.queryByText('Try first')).not.toBeInTheDocument();
  });

  it('is fixed to This PC, with no menu, when the tool cannot move', () => {
    setup({ locked: true, choice: 'body' });
    const control = screen.getByRole('button', { name: /Runs on.*Gmail.*This PC/ });
    expect(control).toBeDisabled();
  });
});
