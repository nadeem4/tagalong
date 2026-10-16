/** Tests for MessageList: order, roles, the streaming bubble and a fired watch. */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MessageList, type ChatMessage } from './message-list';

const messages: ChatMessage[] = [
  { id: 'm1', role: 'user', text: 'What is this?' },
  { id: 'm2', role: 'assistant', text: 'A fox.' },
];

describe('MessageList', () => {
  it('renders the conversation in order with each message tagged by role', () => {
    render(<MessageList messages={messages} petName="Scout" streamingText="" />);

    expect(screen.getByText('What is this?')).toHaveAttribute('data-role', 'user');
    expect(screen.getByText('A fox.')).toHaveAttribute('data-role', 'assistant');
  });

  it('renders the in-flight assistant text as a separate streaming bubble', () => {
    const { rerender } = render(
      <MessageList messages={messages} petName="Scout" streamingText="A f" />,
    );
    expect(screen.getByTestId('streaming-message')).toHaveTextContent('A f');

    rerender(<MessageList messages={messages} petName="Scout" streamingText="A fox with" />);
    expect(screen.getByTestId('streaming-message')).toHaveTextContent('A fox with');
  });

  it('shows no streaming bubble when nothing is in flight', () => {
    render(<MessageList messages={messages} petName="Scout" streamingText="" />);

    expect(screen.queryByTestId('streaming-message')).not.toBeInTheDocument();
  });

  it('names the companion on a fired watch, with what it was watching for', () => {
    render(
      <MessageList
        petName="Scout"
        streamingText=""
        messages={[
          {
            id: 'w1',
            role: 'assistant',
            kind: 'watch',
            text: 'Build succeeded.',
            condition: 'the build finishes',
          },
        ]}
      />,
    );

    expect(screen.getByTestId('watch-fired')).toHaveTextContent(
      'Scout — watching for “the build finishes”',
    );
  });
});
