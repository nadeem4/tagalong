/** Tests for the window-open rule: web links go to the browser, nothing opens a Tagalong window. */
import { describe, expect, it, vi } from 'vitest';
import { handleWindowOpen } from './external-links';

describe('handleWindowOpen', () => {
  it.each(['https://github.com/x/y', 'http://example.com/a'])(
    'sends %s to the system browser and denies a new window',
    (url) => {
      const openExternal = vi.fn();
      expect(handleWindowOpen(url, openExternal)).toEqual({ action: 'deny' });
      expect(openExternal).toHaveBeenCalledWith(url);
    },
  );

  it.each(['javascript:alert(1)', 'file:///c:/secret', 'ftp://x.example/y', 'nonsense', ''])(
    'denies %s without opening anything',
    (url) => {
      const openExternal = vi.fn();
      expect(handleWindowOpen(url, openExternal)).toEqual({ action: 'deny' });
      expect(openExternal).not.toHaveBeenCalled();
    },
  );
});
