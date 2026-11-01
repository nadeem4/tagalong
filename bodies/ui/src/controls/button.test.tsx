/** Tests for Button: variant class, type=button by default, disabled does not fire. */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './button';

describe('Button', () => {
  it('variant adds a class and keeps type=button by default', () => {
    render(<Button variant="danger">Delete</Button>);
    const button = screen.getByRole('button', { name: 'Delete' });
    expect(button).toHaveClass('tg-button', 'tg-button--danger');
    expect(button).toHaveAttribute('type', 'button');
  });

  it('lets a caller ask for type=submit', () => {
    render(
      <Button variant="primary" type="submit">
        Save
      </Button>,
    );
    expect(screen.getByRole('button')).toHaveAttribute('type', 'submit');
  });

  it('disabled does not fire onClick', () => {
    const onClick = vi.fn();
    render(
      <Button variant="secondary" disabled onClick={onClick}>
        Go
      </Button>,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });
});
