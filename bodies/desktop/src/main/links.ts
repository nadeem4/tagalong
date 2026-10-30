/**
 * The links main will open for the engine: a connected app's https sign-in page. Contains
 * isSignInPage.
 */

/**
 * A connected app's sign-in page, which the engine asks main to open. It comes from the
 * app's own sign-in metadata rather than from a renderer, and only https is opened: a
 * `file:` or plain-http address is never handed to the system browser.
 */
export function isSignInPage(url: string): boolean {
  return URL.canParse(url) && new URL(url).protocol === 'https:';
}
