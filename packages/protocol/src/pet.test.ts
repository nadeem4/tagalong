/** Tests for the Pet schema, including its defaults and watchModel. */
import { describe, expect, it } from 'vitest';
import { Pet } from './pet';

const valid = {
  id: 'scout',
  name: 'Scout',
  avatar: '🔎',
  roleId: 'companion',
  model: 'claude-sonnet-5',
  providerId: 'anthropic',
};

describe('Pet', () => {
  it('parses a minimal pet and fills defaults', () => {
    const parsed = Pet.parse(valid);
    expect(parsed.toolGrants).toEqual({});
    expect(parsed.replyStyle).toBe('text');
    expect(parsed.notes).toBeUndefined();
  });

  it('keeps an explicit reply style, grants and notes', () => {
    const parsed = Pet.parse({
      ...valid,
      replyStyle: 'voice-summary',
      toolGrants: { watch_for: 'off', remember: 'allowed' },
      notes: 'Answer in haiku.',
    });
    expect(parsed.replyStyle).toBe('voice-summary');
    expect(parsed.toolGrants).toEqual({ watch_for: 'off', remember: 'allowed' });
    expect(parsed.notes).toBe('Answer in haiku.');
  });

  it('rejects a grant other than off or allowed', () => {
    expect(Pet.safeParse({ ...valid, toolGrants: { watch_for: 'ask' } }).success).toBe(false);
  });

  it('carries a role', () => {
    const parsed = Pet.parse(valid);
    expect(parsed.roleId).toBe('companion');
    const { roleId: _roleId, ...withoutRole } = valid;
    expect(Pet.safeParse(withoutRole).success).toBe(false);
  });

  it('still parses stored JSON carrying the legacy persona and allowlist keys', () => {
    const parsed = Pet.parse({ ...valid, persona: 'You are Scout.', toolAllowlist: [] });
    expect(parsed).not.toHaveProperty('persona');
    expect(parsed).not.toHaveProperty('toolAllowlist');
  });

  it('still parses a crew-era pet, dropping its role version and voice id', () => {
    const parsed = Pet.parse({ ...valid, roleVersion: 2, voiceId: 'fox' });
    expect(parsed).not.toHaveProperty('roleVersion');
    expect(parsed).not.toHaveProperty('voiceId');
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

describe('Pet.watchModel', () => {
  const pet = {
    id: 'scout',
    name: 'Scout',
    avatar: 'S',
    roleId: 'generalist',
    model: 'nvidia/nemotron-3-super-120b-a12b',
    providerId: 'nebius',
  };

  it('is optional: absent means the provider default check model', () => {
    expect(Pet.parse(pet).watchModel).toBeUndefined();
  });

  it('keeps a model the user picked and refuses an empty one', () => {
    expect(Pet.parse({ ...pet, watchModel: 'nano' }).watchModel).toBe('nano');
    expect(Pet.safeParse({ ...pet, watchModel: '' }).success).toBe(false);
  });
});
