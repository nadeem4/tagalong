/** Tests for the walkthrough shell: side list, footer, Back and Next and the single Skip. */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HAS_KEY, makeWalkthroughHost } from './test-host';
import { Walkthrough } from './walkthrough';

const SCOUT = { src: 'bean.webp', frames: 1, fps: 1, loop: false };

function open(host = makeWalkthroughHost(), initialStep?: number) {
  render(
    <Walkthrough
      host={host}
      scout={SCOUT}
      {...(initialStep === undefined ? {} : { initialStep })}
    />,
  );
  return host;
}

const sideButton = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}`) });

describe('Walkthrough', () => {
  it('renders nine step names and the footnote', () => {
    open();
    const list = screen.getByRole('list', { name: 'Steps' });
    expect(list.querySelectorAll('li')).toHaveLength(9);
    expect(
      screen.getByText('You can change all of this later in Home, under Settings.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Your companion')).toBeInTheDocument();
  });

  it('labels the API key step Required without a key and Key set with one', async () => {
    const { unmount } = render(<Walkthrough host={makeWalkthroughHost()} scout={SCOUT} />);
    expect(sideButton('API key')).toHaveTextContent('Required');
    unmount();
    open(makeWalkthroughHost({ key: HAS_KEY }));
    await waitFor(() => expect(sideButton('API key')).toHaveTextContent('Key set'));
    expect(sideButton('API key')).not.toHaveTextContent('Required');
  });

  it('marks the navy side panel on-navy so shared controls get the gold focus ring', () => {
    open();
    expect(screen.getByRole('list', { name: 'Steps' }).closest('aside')).toHaveClass('on-navy');
    expect(screen.getByRole('main')).not.toHaveClass('on-navy');
  });

  it('hides Back on step 1', () => {
    open();
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
  });

  it('Next advances, and Skip without a key goes to step 9 without saving', async () => {
    const host = open();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'One companion for everything you do',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Get started' }));
    await screen.findByRole('heading', { name: 'Ask, and Scout finds the way' });
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    await waitFor(() => expect(sideButton('API key')).toHaveAttribute('aria-current', 'step'));
    expect(host.saveSettings).not.toHaveBeenCalled();
    expect(host.setDailyLimit).not.toHaveBeenCalled();
  });

  it('the side list jumps only to reached steps', async () => {
    open();
    expect(sideButton('Voice')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Get started' }));
    await screen.findByRole('heading', { name: 'Ask, and Scout finds the way' });
    fireEvent.click(sideButton('Welcome'));
    await screen.findByRole('heading', { name: 'One companion for everything you do' });
    expect(sideButton('How it works')).toBeEnabled();
    expect(sideButton('What to ask')).toBeDisabled();
  });

  it('opens at the step it is given and counts every step before it as reached', () => {
    open(makeWalkthroughHost(), 9);
    expect(sideButton('Welcome')).toBeEnabled();
    expect(sideButton('API key')).toHaveAttribute('aria-current', 'step');
  });

  it('Skip with a key closes and calls finishWalkthrough', async () => {
    const host = open(makeWalkthroughHost({ key: HAS_KEY }));
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    await waitFor(() => expect(host.finishWalkthrough).toHaveBeenCalledTimes(1));
  });

  it('Skip without a key goes to step 9 and does not finish', async () => {
    const host = open();
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    await waitFor(() => expect(sideButton('API key')).toHaveAttribute('aria-current', 'step'));
    expect(host.finishWalkthrough).not.toHaveBeenCalled();
  });

  it('Skip with the brain offline counts as no key', async () => {
    const host = open(makeWalkthroughHost({ key: 'offline' }));
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    await waitFor(() => expect(sideButton('API key')).toHaveAttribute('aria-current', 'step'));
    expect(host.finishWalkthrough).not.toHaveBeenCalled();
  });

  it('saves nothing before Next, so Back loses no data', async () => {
    const host = open(makeWalkthroughHost(), 4);
    await screen.findByRole('button', { name: 'Change' });
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    fireEvent.change(screen.getByLabelText('Ask key'), { target: { value: 'Alt+Space' } });
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await screen.findByRole('heading', { name: 'Everyday things, said plainly' });
    expect(host.saveSettings).not.toHaveBeenCalled();
  });

  it('does not advance when the save fails, and says why', async () => {
    const host = makeWalkthroughHost();
    host.saveSettings.mockRejectedValueOnce(new Error('That shortcut is taken.'));
    open(host, 4);
    await screen.findByRole('button', { name: 'Change' });
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    fireEvent.change(screen.getByLabelText('Ask key'), { target: { value: 'Alt+Space' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That shortcut is taken.');
    expect(sideButton('Asking')).toHaveAttribute('aria-current', 'step');
  });

  it('moves focus to the new step headline when the step changes', async () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Get started' }));
    const heading = await screen.findByRole('heading', { name: 'Ask, and Scout finds the way' });
    await waitFor(() => expect(heading).toHaveFocus());
  });
});

describe('Walkthrough, a non-coder path', () => {
  it('never says Claude Code on steps 1 to 6 unless the expert line is opened', async () => {
    const { container } = render(<Walkthrough host={makeWalkthroughHost()} scout={SCOUT} />);
    expect(container.textContent).not.toMatch(/Claude Code/);
    fireEvent.click(screen.getByRole('button', { name: 'Get started' }));
    for (let step = 2; step <= 5; step += 1) {
      await screen.findByRole('heading', { level: 1 });
      expect(container.textContent, `step ${step}`).not.toMatch(/Claude Code/);
      fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    }
    await screen.findByRole('heading', { name: 'Scout does the everyday jobs' });
    expect(container.textContent).not.toMatch(/Claude Code/);
    fireEvent.click(
      screen.getByRole('button', { name: 'For long jobs, Scout can also use an expert' }),
    );
    expect(container.textContent).toMatch(/Claude Code/);
  });
});

describe('Walkthrough, the end', () => {
  it('shows the placeholder-free steps 6 to 9', async () => {
    open(makeWalkthroughHost({ key: HAS_KEY }), 6);
    await screen.findByRole('heading', { name: 'Scout does the everyday jobs' });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('heading', { name: 'Let Scout read your browser tabs' });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('heading', { name: 'Scout asks first, and you set the limit' });
    // Dense steps scroll inside the content panel, with the footer outside it.
    expect((await screen.findByLabelText('Daily limit (USD)')).closest('.wt-body')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('heading', { name: 'Add your Anthropic API key' });
    expect(screen.queryByText(/coming in the next update/)).not.toBeInTheDocument();
  });

  it('Finish is off on step 9 until the key is set, and there is no Skip', async () => {
    open(makeWalkthroughHost(), 9);
    await screen.findByText(/Saved on the machine running/);
    expect(screen.getByRole('button', { name: 'Finish' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Skip' })).not.toBeInTheDocument();
  });

  it('Finish with a key opens the finish card; Done finishes once, Open Home opens Home first', async () => {
    const host = open(makeWalkthroughHost({ key: HAS_KEY }), 9);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Finish' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    await screen.findByRole('heading', { name: 'Scout is on your screen' });
    // Finish marks the tour seen at once, without closing, so closing the card with X is safe.
    expect(host.finishWalkthrough).toHaveBeenCalledTimes(1);
    expect(host.finishWalkthrough).toHaveBeenCalledWith({ close: false });
    expect(screen.getAllByText(/^(Ctrl|Shift|Space|Right Ctrl)$/)).toHaveLength(4);
    const close = screen.getByRole('button', { name: 'Done' });
    fireEvent.click(close);
    fireEvent.click(close);
    // Once to mark the tour seen (no close), once to close; the double click closes once.
    await waitFor(() => expect(host.finishWalkthrough).toHaveBeenCalledTimes(2));
    expect(host.finishWalkthrough).toHaveBeenLastCalledWith();
    expect(host.openHome).not.toHaveBeenCalled();
  });

  it('a failure while closing shows an alert instead of an unhandled rejection', async () => {
    const host = open(makeWalkthroughHost({ key: HAS_KEY }), 9);
    host.finishWalkthrough.mockImplementation((options?: { close?: boolean }) =>
      options?.close === false ? Promise.resolve() : Promise.reject(new Error('Could not close.')),
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Finish' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    await screen.findByRole('heading', { name: 'Scout is on your screen' });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not close.');
  });

  it('Open Home on the card opens Home and finishes the tour', async () => {
    const host = open(makeWalkthroughHost({ key: HAS_KEY }), 9);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Finish' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    await screen.findByRole('heading', { name: 'Scout is on your screen' });
    fireEvent.click(screen.getByRole('button', { name: 'Open Home' }));
    await waitFor(() => expect(host.finishWalkthrough).toHaveBeenCalledTimes(2));
    expect(host.openHome).toHaveBeenCalledTimes(1);
  });
});
