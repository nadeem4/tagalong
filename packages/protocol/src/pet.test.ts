/** Tests for the Pet schema, including the keys it drops, SCOUT_ID and watchModel. */
import { describe, expect, it } from 'vitest';
import { Pet, SCOUT_ID } from './pet';

const valid = {
  id: 'scout',
  name: 'Scout',
  avatar: '🔎',
  roleId: 'companion',
  model: 'claude-sonnet-5',
  providerId: 'anthropic',
};

describe('Pet', () => {
  it('parses a minimal pet as it is', () => {
    expect(Pet.parse(valid)).toEqual(valid);
  });

  it('still parses a crew-era pet, dropping its grants, reply style and notes', () => {
    const parsed = Pet.parse({
      ...valid,
      toolGrants: { remember: 'off' },
      replyStyle: 'voice-full',
      notes: 'x',
    });
    expect(parsed).not.toHaveProperty('toolGrants');
    expect(parsed).not.toHaveProperty('replyStyle');
    expect(parsed).not.toHaveProperty('notes');
  });

  it("names Scout's id", () => {
    expect(SCOUT_ID).toBe('scout');
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

  it('rejects an empty name', () => {
    expect(Pet.safeParse({ ...valid, name: '' }).success).toBe(false);
  });

  it('rejects a missing model', () => {
    const { model: _model, ...withoutModel } = valid;
    expect(Pet.safeParse(withoutModel).success).toBe(false);
  });

  it('drops the retired vision model an older pet still carries', () => {
    expect(Pet.parse({ ...valid, visionModel: 'vl' })).not.toHaveProperty('visionModel');
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
    model: 'anthropic/claude-sonnet-5',
    providerId: 'openrouter',
  };

  it('is optional: absent means the provider default check model', () => {
    expect(Pet.parse(pet).watchModel).toBeUndefined();
  });

  it('keeps a model the user picked and refuses an empty one', () => {
    expect(Pet.parse({ ...pet, watchModel: 'nano' }).watchModel).toBe('nano');
    expect(Pet.safeParse({ ...pet, watchModel: '' }).success).toBe(false);
  });
});
