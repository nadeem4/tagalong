import { describe, expect, it } from 'vitest';
import { ContextSnapshot, MAX_PAGE_TEXT_CHARS, MAX_SELECTION_CHARS } from './context';

const valid = {
  id: '9f1d6b64-2a5e-4f3a-9c11-8a2e7b4d5c60',
  capturedAt: '2026-09-11T23:15:00.000Z',
  host: 'desktop',
  app: { name: 'Code.exe', windowTitle: 'index.ts - tagalong' },
  selection: 'the highlighted paragraph',
};

describe('ContextSnapshot', () => {
  it('parses a desktop snapshot with a selection', () => {
    const parsed = ContextSnapshot.parse(valid);
    expect(parsed.host).toBe('desktop');
    expect(parsed.app?.name).toBe('Code.exe');
  });

  it('parses an extension snapshot carrying page text', () => {
    const parsed = ContextSnapshot.parse({
      ...valid,
      host: 'extension',
      page: { url: 'https://example.com/a', title: 'A', text: 'body text' },
    });
    expect(parsed.page?.url).toBe('https://example.com/a');
  });

  it('rejects an unknown host kind', () => {
    expect(ContextSnapshot.safeParse({ ...valid, host: 'toaster' }).success).toBe(false);
  });

  it('rejects a non-uuid id', () => {
    expect(ContextSnapshot.safeParse({ ...valid, id: 'not-a-uuid' }).success).toBe(false);
  });

  it('rejects a non-ISO capturedAt', () => {
    expect(ContextSnapshot.safeParse({ ...valid, capturedAt: 'yesterday' }).success).toBe(false);
  });

  it('caps the selection at the documented budget', () => {
    expect(
      ContextSnapshot.safeParse({ ...valid, selection: 'x'.repeat(MAX_SELECTION_CHARS) }).success,
    ).toBe(true);
    expect(
      ContextSnapshot.safeParse({ ...valid, selection: 'x'.repeat(MAX_SELECTION_CHARS + 1) })
        .success,
    ).toBe(false);
  });

  it('caps page text at the documented budget', () => {
    const page = {
      url: 'https://example.com',
      title: 'T',
      text: 'x'.repeat(MAX_PAGE_TEXT_CHARS + 1),
    };
    expect(ContextSnapshot.safeParse({ ...valid, page }).success).toBe(false);
  });

  it('accepts a png screenshot block', () => {
    const parsed = ContextSnapshot.parse({
      ...valid,
      screenshot: { mime: 'image/png', base64: 'aGk=', width: 1568, height: 900 },
    });
    expect(parsed.screenshot?.width).toBe(1568);
  });

  it('rejects a screenshot that is not png', () => {
    const screenshot = { mime: 'image/jpeg', base64: 'aGk=', width: 10, height: 10 };
    expect(ContextSnapshot.safeParse({ ...valid, screenshot }).success).toBe(false);
  });
});
