/** Tests for Keycap and Shortcut: accelerators render as one kbd per key, never raw Electron names. */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Shortcut } from './keycap';

const keys = (container: HTMLElement) =>
  [...container.querySelectorAll('kbd')].map((k) => k.textContent);

describe('Shortcut', () => {
  it('renders CommandOrControl+Shift+Space as Ctrl, Shift, Space', () => {
    const { container } = render(<Shortcut accelerator="CommandOrControl+Shift+Space" />);
    expect(keys(container)).toEqual(['Ctrl', 'Shift', 'Space']);
  });

  it('never outputs the text CommandOrControl', () => {
    const { container } = render(<Shortcut accelerator="CmdOrCtrl+K" />);
    expect(container.textContent).not.toMatch(/CommandOrControl|CmdOrCtrl/);
    expect(keys(container)).toEqual(['Ctrl', 'K']);
  });

  it('maps Command to Cmd', () => {
    const { container } = render(<Shortcut accelerator="Command+J" />);
    expect(keys(container)).toEqual(['Cmd', 'J']);
  });

  it('renders nothing for an empty accelerator', () => {
    const { container } = render(<Shortcut accelerator="" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders an unknown token as it is', () => {
    const { container } = render(<Shortcut accelerator="Foo+Bar" />);
    expect(keys(container)).toEqual(['Foo', 'Bar']);
  });
});
