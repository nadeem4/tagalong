import { describe, expect, it } from 'vitest';
import { Pet } from './pet';

const valid = {
  id: 'scout',
  name: 'Scout',
  avatar: '🔎',
  persona: 'You explain things plainly.',
  model: 'claude-sonnet-5',
  providerId: 'anthropic',
};

describe('Pet', () => {
  it('parses a minimal pet and fills defaults', () => {
    const parsed = Pet.parse(valid);
    expect(parsed.toolAllowlist).toEqual([]);
    expect(parsed.replyStyle).toBe('text');
  });

  it('keeps an explicit reply style and allowlist', () => {
    const parsed = Pet.parse({
      ...valid,
      replyStyle: 'voice-summary',
      toolAllowlist: ['notion__search'],
    });
    expect(parsed.replyStyle).toBe('voice-summary');
    expect(parsed.toolAllowlist).toEqual(['notion__search']);
  });

  it('rejects an unknown reply style', () => {
    expect(Pet.safeParse({ ...valid, replyStyle: 'interpretive-dance' }).success).toBe(false);
  });

  it('rejects an empty name', () => {
    expect(Pet.safeParse({ ...valid, name: '' }).success).toBe(false);
  });

  it('rejects a missing model', () => {
    const { model: _model, ...withoutModel } = valid;
    expect(Pet.safeParse(withoutModel).success).toBe(false);
  });

  it('leaves the vision model out when none is named', () => {
    expect(Pet.parse(valid).visionModel).toBeUndefined();
  });

  it('keeps a vision model', () => {
    expect(Pet.parse({ ...valid, visionModel: 'vl' }).visionModel).toBe('vl');
  });

  it('rejects an empty vision model', () => {
    expect(Pet.safeParse({ ...valid, visionModel: '' }).success).toBe(false);
  });

  it('keeps a colour the crew strip can paint', () => {
    expect(Pet.parse({ ...valid, color: '#0ea5e9' }).color).toBe('#0ea5e9');
  });

  it('rejects a colour that is not a six-digit hex', () => {
    expect(Pet.safeParse({ ...valid, color: 'blue' }).success).toBe(false);
  });
});
