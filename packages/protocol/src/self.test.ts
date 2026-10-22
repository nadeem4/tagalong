/** Tests for the Self schemas and the self.* methods. */
import { describe, expect, it } from 'vitest';
import { hostToCoreMethods } from './methods';
import {
  SelfAcceptParams,
  SelfAcceptResult,
  SelfGetParams,
  SelfGetResult,
  SelfGetResult as Get,
  SelfListParams,
  SelfListResult,
  SelfRejectParams,
  SelfRejectResult,
  SelfUndoParams,
  SelfUndoResult,
  SelfWriteParams,
  SelfWriteResult,
} from './self';

const AT = '2026-10-19T10:00:00.000Z';

describe('the Self', () => {
  it('lists pages and nights', () => {
    const listed = {
      pages: [{ path: 'you.md', chars: 18, updatedAt: AT, proposals: 1 }],
      nights: [{ state: 'done', startedAt: AT, note: 'Changed lessons.md.' }],
    };
    expect(SelfListResult.parse(listed)).toEqual(listed);
  });

  it('gets a page with its versions by author, or null', () => {
    const page = {
      path: 'lessons.md',
      text: 'Lead with the gist.',
      versions: [
        {
          id: 3,
          path: 'lessons.md',
          author: 'scout',
          why: 'Tidied.',
          state: 'applied',
          acceptedBy: 'person',
          text: 'Lead with the gist.',
          chars: 19,
          at: AT,
        },
        {
          id: 2,
          path: 'lessons.md',
          author: 'sleep',
          why: 'Tidied.',
          state: 'proposed',
          text: 'Lead.',
          chars: 5,
          at: AT,
        },
      ],
    };
    expect(Get.parse(page)).toEqual(page);
    expect(SelfGetResult.parse(null)).toBeNull();
    expect(
      Get.safeParse({ ...page, versions: [{ ...page.versions[0], author: 'stranger' }] }).success,
    ).toBe(false);
    expect(
      Get.safeParse({ ...page, versions: [{ ...page.versions[0], state: 'maybe' }] }).success,
    ).toBe(false);
  });

  it('says when their own edit was clipped to fit', () => {
    expect(SelfWriteResult.parse({ ok: true, note: 'Kept the first 3000 characters.' })).toEqual({
      ok: true,
      note: 'Kept the first 3000 characters.',
    });
  });

  it('are host-to-core methods', () => {
    expect(hostToCoreMethods['self.list']).toEqual({
      params: SelfListParams,
      result: SelfListResult,
    });
    expect(hostToCoreMethods['self.get']).toEqual({ params: SelfGetParams, result: SelfGetResult });
    expect(hostToCoreMethods['self.write']).toEqual({
      params: SelfWriteParams,
      result: SelfWriteResult,
    });
    expect(hostToCoreMethods['self.undo']).toEqual({
      params: SelfUndoParams,
      result: SelfUndoResult,
    });
    expect(hostToCoreMethods['self.accept']).toEqual({
      params: SelfAcceptParams,
      result: SelfAcceptResult,
    });
    expect(hostToCoreMethods['self.reject']).toEqual({
      params: SelfRejectParams,
      result: SelfRejectResult,
    });
  });
});
