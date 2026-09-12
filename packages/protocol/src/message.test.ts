import { describe, expect, it } from 'vitest';
import { Message, MessageContent } from './message';

const base = {
  id: '2b0f5a1c-8d3e-4a7b-9c21-5e6f7a8b9c00',
  conversationId: '7c1e2d3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f',
  role: 'user',
  createdAt: '2026-09-11T23:20:00.000Z',
};

describe('MessageContent', () => {
  it('parses each content block kind', () => {
    expect(MessageContent.parse({ type: 'text', text: 'hi' }).type).toBe('text');
    expect(MessageContent.parse({ type: 'image', mime: 'image/png', base64: 'aGk=' }).type).toBe(
      'image',
    );
    expect(
      MessageContent.parse({ type: 'tool_use', id: 't1', name: 'search', input: {} }).type,
    ).toBe('tool_use');
    expect(MessageContent.parse({ type: 'tool_result', toolUseId: 't1', content: 'ok' }).type).toBe(
      'tool_result',
    );
  });

  it('rejects an unknown block kind', () => {
    expect(MessageContent.safeParse({ type: 'telepathy', text: 'hi' }).success).toBe(false);
  });
});

describe('Message', () => {
  it('parses a user message with text content', () => {
    const parsed = Message.parse({ ...base, content: [{ type: 'text', text: 'explain this' }] });
    expect(parsed.role).toBe('user');
    expect(parsed.content).toHaveLength(1);
  });

  it('rejects an empty content array', () => {
    expect(Message.safeParse({ ...base, content: [] }).success).toBe(false);
  });

  it('rejects an unknown role', () => {
    expect(
      Message.safeParse({ ...base, role: 'system', content: [{ type: 'text', text: 'x' }] })
        .success,
    ).toBe(false);
  });
});
