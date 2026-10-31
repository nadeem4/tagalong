/** Tests for steps 1 to 3: each shows its headline and every row of the spec's copy. */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StepOne } from './step-one';
import { StepThree } from './step-three';
import { StepTwo } from './step-two';

describe('StepOne', () => {
  it('shows the idea, the four-minute note and the example card', () => {
    render(<StepOne />);
    expect(
      screen.getByRole('heading', { name: 'One companion for all your AI tools' }),
    ).toBeInTheDocument();
    for (const text of [
      'Scout stays with you',
      'Experts do the heavy work',
      'Your apps come along',
      'Back where you are',
      'Claude Code · finished',
      'Fixed the empty-cart crash in billing.ts and added a test.',
      'See the job',
      'This takes about four minutes.',
    ]) {
      expect(screen.getByText(text, { exact: false })).toBeInTheDocument();
    }
    expect(screen.getByText(/The last step needs an Anthropic API key/)).toBeInTheDocument();
  });
});

describe('StepTwo', () => {
  it('shows who does what and what is Now, Coming and Later', () => {
    render(<StepTwo />);
    expect(screen.getByRole('heading', { name: 'How it fits together' })).toBeInTheDocument();
    for (const text of [
      'Claude Code',
      'Gemini CLI',
      'Codex',
      'Other coding agents',
      'Model APIs, tool servers',
      'Connected apps',
      'Notion',
      'GitHub',
      'Linear',
      'Any MCP server',
      'You ask once',
      'Scout routes',
      'Nothing goes unseen',
    ]) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
    expect(screen.getByText('Now')).toBeInTheDocument();
    expect(screen.getAllByText('Coming')).toHaveLength(3);
    expect(screen.getByText('Later')).toBeInTheDocument();
    expect(screen.getByText(/Each hand-off waits for your Send/)).toBeInTheDocument();
  });
});

describe('StepThree', () => {
  it('lists the six everyday examples with who handles each', () => {
    render(<StepThree />);
    expect(screen.getByRole('heading', { name: 'Things you can ask' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(6);
    for (const text of [
      'Fix this test and tell me what was wrong.',
      'Which plan fits a team of five?',
      'Remind me in 20 minutes to call Sam.',
      'Tell me when the job finishes.',
      'Add this article to my reading list.',
      "What's on my other screen?",
    ]) {
      expect(screen.getByText(text, { exact: false })).toBeInTheDocument();
    }
  });
});
