/** Tests for RunsOn: the four choices, Try first under Both, and Escape giving focus back to the control. */
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
      canAsk
      onChange={onChange}
      {...props}
    />,
  );
  return onChange;
}

describe('RunsOn', () => {
  it('offers the machine, This PC, Both and Ask me each time, and chooses one', () => {
    const onChange = setup();
    open();
    for (const label of ['mini-pc', 'This PC', 'Both', 'Ask me each time']) {
      expect(screen.getByRole('button', { name: new RegExp(`^${label}`) })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole('button', { name: /^This PC/ }));
    expect(onChange).toHaveBeenCalledWith('body', 'body');
  });

  it('leaves out Ask me each time where Scout never asks', () => {
    setup({ canAsk: false });
    open();
    expect(screen.queryByRole('button', { name: /^Ask me each time/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Both/ })).toBeInTheDocument();
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
    expect(screen.getByRole('group', { name: 'Where Gmail runs' })).toBeInTheDocument();
    expect(screen.queryByText('Try first')).not.toBeInTheDocument();
  });

  it('closes on Escape and gives focus back to the control', () => {
    setup();
    open();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('group', { name: 'Where Gmail runs' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Runs on.*Gmail/ })).toHaveFocus();
  });
});
