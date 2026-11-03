/** Tests for steps 1 to 3: the one-companion pitch, the route a request takes, and the five moments. */

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StepOne } from './step-one';
import { StepThree } from './step-three';
import { StepTwo } from './step-two';

const PROMPTS = [
  'What’s on today?',
  'Say no to Thursday, kindly',
  'Which plan fits a team of five?',
  'Fix this failing test',
  'Remind me in 20 minutes to call Sam',
];

describe('StepOne', () => {
  it('says "One companion for everything you do" and never "AI tools"', () => {
    const { container } = render(<StepOne />);
    expect(
      screen.getByRole('heading', { name: 'One companion for everything you do' }),
    ).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/AI tools/i);
  });

  it('lists three moments of the day', () => {
    render(<StepOne />);
    expect(screen.getByText('A day with Scout')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    for (const text of PROMPTS.filter((_, index) => index !== 2 && index !== 3)) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
  });
});

describe('StepTwo', () => {
  it('shows the three ways Scout helps, in order', () => {
    render(<StepTwo />);
    expect(
      screen.getByRole('heading', { name: 'Ask, and Scout finds the way' }),
    ).toBeInTheDocument();
    const routes = screen.getByRole('list', { name: 'Ways Scout helps' });
    expect(
      within(routes)
        .getAllByRole('listitem')
        .map((item) => item.querySelector('strong')?.textContent),
    ).toEqual(['Answers itself', 'Uses your apps', 'Brings in an expert']);
  });

  it('exposes the flow as an ordered list with an aria-label', () => {
    render(<StepTwo />);
    const flow = screen.getByRole('list', { name: 'How a request travels' });
    expect(flow.tagName).toBe('OL');
  });

  it('shows the app chips as list items, not buttons', () => {
    render(<StepTwo />);
    const apps = screen.getByRole('list', { name: 'Apps you can connect' });
    expect(
      within(apps)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Notion', 'GitHub', 'Linear', 'Google Calendar', 'Any MCP server']);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('StepThree', () => {
  it('renders the five prompts in order with their outcomes', () => {
    render(<StepThree />);
    expect(
      screen.getByRole('heading', { name: 'Everyday things, said plainly' }),
    ).toBeInTheDocument();
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(5);
    items.forEach((item, index) => {
      expect(item).toHaveTextContent(PROMPTS[index] ?? '');
    });
    expect(
      screen.getByText(/Hands it to an expert and tells you when it’s done/),
    ).toBeInTheDocument();
  });

  it('has no button for them (static)', () => {
    render(<StepThree />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
