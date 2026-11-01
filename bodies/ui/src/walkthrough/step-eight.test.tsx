/** Tests for step 8: the daily limit starts at the brain's value and saves only on Next. */

import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StepEight } from './step-eight';
import { makeWalkthroughHost, mountStep, NO_KEY } from './test-host';

const limit = () => screen.getByLabelText('Daily limit (USD)') as HTMLInputElement;

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
    await waitFor(() => expect(step.registered()).toBe(true));
    fireEvent.change(limit(), { target: { value: '8.5' } });
    expect(host.setDailyLimit).not.toHaveBeenCalled();
    await step.save();
    expect(host.setDailyLimit).toHaveBeenCalledWith(8.5);
  });

  it('the money stepper plus raises by one dollar and minus lowers by one', async () => {
    mountStep(<StepEight host={makeWalkthroughHost()} />);
    await screen.findByDisplayValue('5');
    fireEvent.click(screen.getByRole('button', { name: 'Increase' }));
    expect(limit().value).toBe('6');
    fireEvent.click(screen.getByRole('button', { name: 'Decrease' }));
    fireEvent.click(screen.getByRole('button', { name: 'Decrease' }));
    expect(limit().value).toBe('4');
  });

  it('an unchanged amount saves nothing (Skip and Back never reach setDailyLimit)', async () => {
    const host = makeWalkthroughHost();
    const step = mountStep(<StepEight host={host} />);
    await screen.findByDisplayValue('5');
    await waitFor(() => expect(step.registered()).toBe(true));
    await step.save();
    expect(host.setDailyLimit).not.toHaveBeenCalled();
  });

  it('invalid amounts block Next', async () => {
    const host = makeWalkthroughHost();
    const step = mountStep(<StepEight host={host} />);
    await screen.findByDisplayValue('5');
    await waitFor(() => expect(step.registered()).toBe(true));
    for (const bad of ['0', '-3', '', 'abc']) {
      fireEvent.change(limit(), { target: { value: bad } });
      const failure = await step.save().then(
        () => null,
        (error: unknown) => error,
      );
      expect((failure as Error | null)?.message).toBe('Enter an amount above $0.');
    }
    expect(host.setDailyLimit).not.toHaveBeenCalled();
  });

  it('copy covers asks, memory and the limit', async () => {
    mountStep(<StepEight host={makeWalkthroughHost()} />);
    await screen.findByDisplayValue('5');
    expect(
      screen.getByRole('heading', { name: 'Scout asks first, and you set the limit' }),
    ).toBeVisible();
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

  it('uses the shared money field', async () => {
    mountStep(<StepEight host={makeWalkthroughHost()} />);
    await screen.findByDisplayValue('5');
    expect(limit().closest('.tg-money')).not.toBeNull();
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  });

  it('the approval preview is aria-hidden and has no live buttons', async () => {
    mountStep(<StepEight host={makeWalkthroughHost()} />);
    await screen.findByDisplayValue('5');
    const preview = screen.getByText('File this as an issue in GitHub?').closest('[aria-hidden]');
    expect(preview).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('button', { name: 'Allow once' })).not.toBeInTheDocument();
  });
});
