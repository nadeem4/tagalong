/** Tests for InfoPopover: the i button beside a permission's name and the text it opens. */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { InfoPopover } from './info-popover';

function renderIt() {
  render(
    <div>
      <ul>
        <li>
          <span>Read a window</span>
          <InfoPopover label="Read a window" text="Scout reads the words in one window." />
        </li>
      </ul>
      <button type="button">elsewhere</button>
    </div>,
  );
  return screen.getByRole('button', { name: 'About Read a window' });
}

describe('InfoPopover', () => {
  it('is closed until the button is pressed, then shows the text', () => {
    const button = renderIt();
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Scout reads the words in one window.')).toBeNull();
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('dialog', { name: 'About Read a window' })).toHaveTextContent(
      'Scout reads the words in one window.',
    );
  });

  it('opens, Escape closes and focus returns', () => {
    const button = renderIt();
    fireEvent.click(button);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('a click outside closes it, a click on the text does not', () => {
    const button = renderIt();
    fireEvent.click(button);
    fireEvent.mouseDown(screen.getByRole('dialog'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole('button', { name: 'elsewhere' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('pressing the button again closes it', () => {
    const button = renderIt();
    fireEvent.click(button);
    fireEvent.click(button);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
