import { describe, expect, it } from 'vitest';
import {
  NoticesDismissParams,
  NoticesDismissResult,
  NoticesRolesUpgradeParams,
  NoticesRolesUpgradeResult,
  RolesUpgradeNotice,
} from './notices';

const scout = {
  petId: 'scout',
  name: 'Scout',
  roleId: 'generalist',
  keptNotes: false,
  madeByYou: false,
};

describe('RolesUpgradeNotice', () => {
  it('names each upgraded pet, its new role, and what happened to its persona', () => {
    const notice = { pets: [scout, { ...scout, petId: 'pip', name: 'Pip', madeByYou: true }] };
    expect(RolesUpgradeNotice.parse(notice)).toEqual(notice);
  });

  it('refuses a row without a role or a verdict on the persona', () => {
    const { roleId: _role, ...noRole } = scout;
    expect(RolesUpgradeNotice.safeParse({ pets: [noRole] }).success).toBe(false);
    const { keptNotes: _notes, ...noVerdict } = scout;
    expect(RolesUpgradeNotice.safeParse({ pets: [noVerdict] }).success).toBe(false);
  });
});

describe('notices methods', () => {
  it('asks for the roles notice with no params, and answers it or null', () => {
    expect(NoticesRolesUpgradeParams.parse({})).toEqual({});
    expect(NoticesRolesUpgradeResult.parse({ notice: null })).toEqual({ notice: null });
    const pending = { notice: { pets: [scout] } };
    expect(NoticesRolesUpgradeResult.parse(pending)).toEqual(pending);
  });

  it('dismisses a notice by name, and only names it knows', () => {
    expect(NoticesDismissParams.parse({ notice: 'rolesUpgrade' })).toEqual({
      notice: 'rolesUpgrade',
    });
    expect(NoticesDismissParams.safeParse({ notice: 'somethingElse' }).success).toBe(false);
    expect(NoticesDismissResult.parse({ dismissed: true })).toEqual({ dismissed: true });
  });
});
