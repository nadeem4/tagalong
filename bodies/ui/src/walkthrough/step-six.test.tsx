/**
 * Tests for step 6: the everyday jobs are explained and nothing is connected here; connecting
 * lives on the last step.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { JOB_KINDS } from '../jobs-kinds';
import { StepSix } from './step-six';

describe('StepSix', () => {
  it('lists every everyday job with its help line', () => {
    render(<StepSix />);
    for (const job of JOB_KINDS) {
      expect(screen.getByRole('heading', { name: job.label })).toBeInTheDocument();
      expect(screen.getByText(job.help)).toBeInTheDocument();
    }
  });

  it('step six has no connect or setup buttons', () => {
    render(<StepSix />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('points to the last step for connecting', () => {
    render(<StepSix />);
    expect(screen.getByText(/connect your tools at the end of the tour/i)).toBeInTheDocument();
  });
});
