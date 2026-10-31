/** Tests for step 8: the daily limit starts at the brain's value and saves only on Next. */

import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StepEight } from './step-eight';
import { makeWalkthroughHost, mountStep, NO_KEY } from './test-host';

const limit = () => screen.getByLabelText('Daily spending limit') as HTMLInputElement;

describe('StepEight', () => {
  it('starts at the brain’s limit', async () => {
    mountStep(<StepEight host={makeWalkthroughHost({ key: { ...NO_KEY, dailyLimitUsd: 12 } })} />);
    await screen.findByDisplayValue('12');
  });

  it('shows the default $5', async () => {
    mountStep(<StepEight host={makeWalkthroughHost()} />);
    await screen.findByDisplayValue('5');
  });

  it('Next saves a changed amount through setDailyLimit, and not before', async () => {
    const host = makeWalkthroughHost();
    const step = mountStep(<StepEight host={host} />);
    await screen.findByDisplayValue('5');
    fireEvent.change(limit(), { target: { value: '8.5' } });
    expect(host.setDailyLimit).not.toHaveBeenCalled();
    await step.save();
    expect(host.setDailyLimit).toHaveBeenCalledWith(8.5);
  });

  it('the plus and minus buttons step the amount by one dollar', async () => {
    mountStep(<StepEight host={makeWalkthroughHost()} />);
    await screen.findByDisplayValue('5');
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(limit().value).toBe('6');
    fireEvent.click(screen.getByRole('button', { name: 'Less' }));
    fireEvent.click(screen.getByRole('button', { name: 'Less' }));
    expect(limit().value).toBe('4');
  });

  it('an unchanged amount saves nothing (Skip for now and Back never reach setDailyLimit)', async () => {
    const host = makeWalkthroughHost();
    const step = mountStep(<StepEight host={host} />);
    await screen.findByDisplayValue('5');
    await step.save();
    expect(host.setDailyLimit).not.toHaveBeenCalled();
  });

  it('invalid amounts block Next', async () => {
    const host = makeWalkthroughHost();
    const step = mountStep(<StepEight host={host} />);
    await screen.findByDisplayValue('5');
    for (const bad of ['0', '-3', '', 'abc']) {
      fireEvent.change(limit(), { target: { value: bad } });
      await expect(step.save()).rejects.toThrow('Enter an amount above $0.');
    }
    expect(host.setDailyLimit).not.toHaveBeenCalled();
  });

  it('copy covers asks, memory and the limit', async () => {
    mountStep(<StepEight host={makeWalkthroughHost()} />);
    await screen.findByDisplayValue('5');
    expect(screen.getByRole('heading', { name: 'You stay in charge' })).toBeVisible();
    for (const text of [
      'It asks first',
      'Home > Approvals',
      'Scout’s thinking is billed to your API key.',
      'What it remembers',
      'Scout, forget that',
      'File this as an issue in GitHub?',
    ]) {
      expect(screen.getAllByText(text, { exact: false }).length).toBeGreaterThan(0);
    }
  });
});
