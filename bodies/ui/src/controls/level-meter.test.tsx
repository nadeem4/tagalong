/** Tests for LevelMeter: a read-only meter with a rounded percentage and a bar width. */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LevelMeter } from './level-meter';

describe('LevelMeter', () => {
  it('exposes role meter with aria-valuenow rounded', () => {
    render(<LevelMeter level={0.456} label="Microphone level" />);
    const meter = screen.getByRole('meter', { name: 'Microphone level' });
    expect(meter).toHaveAttribute('aria-valuemin', '0');
    expect(meter).toHaveAttribute('aria-valuemax', '100');
    expect(meter).toHaveAttribute('aria-valuenow', '46');
  });

  it('clamps out-of-range levels', () => {
    render(<LevelMeter level={3} />);
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '100');
  });
});
