/**
 * Whether a Bean clip's strip really loads in its window. A CSP or packaging miss leaves the
 * background blank with no error a unit test can see. Contains stripLoaded.
 */
import type { Locator } from '@playwright/test';

/** 'loaded', or why not: the computed background is read and loaded as an image in the page. */
export function stripLoaded(clip: Locator): Promise<string> {
  return clip.evaluate((el) => {
    const url = /url\("?(.+?)"?\)/.exec(getComputedStyle(el).backgroundImage)?.[1];
    if (url === undefined) return 'no background';
    return new Promise<string>((resolve) => {
      const image = new Image();
      image.onload = () => resolve(image.naturalWidth > 0 ? 'loaded' : `empty: ${url}`);
      image.onerror = () => resolve(`failed: ${url}`);
      image.src = url;
    });
  });
}
