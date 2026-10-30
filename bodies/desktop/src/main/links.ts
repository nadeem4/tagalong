/**
 * The links main will open for a renderer or the engine: provider key pages, coding-agent install
 * pages and https sign-in pages. Contains isAllowedLink and isSignInPage.
 */

/**
 * The only pages a renderer may ask main to open in the browser: where each provider's
 * API key is made. An allowlist rather than "any https URL", because a renderer that
 * could open anything could be talked into opening anything.
 */
const ALLOWED_LINK_ORIGINS: ReadonlySet<string> = new Set([
  'https://openrouter.ai',
  'https://console.anthropic.com',
]);

/** Where someone is sent to install a coding agent: these pages exactly, no others. */
const ALLOWED_LINKS: ReadonlySet<string> = new Set([
  'https://claude.com/claude-code',
  'https://github.com/google-gemini/gemini-cli',
  'https://github.com/openai/codex',
]);

/** Whether a link is a provider key page or a coding agent's install page. */
export function isAllowedLink(url: string): boolean {
  if (!URL.canParse(url)) return false;
  return ALLOWED_LINK_ORIGINS.has(new URL(url).origin) || ALLOWED_LINKS.has(url);
}

/**
 * A connected app's sign-in page, which the engine asks main to open. It comes from the
 * app's own sign-in metadata rather than from a renderer, and only https is opened: a
 * `file:` or plain-http address is never handed to the system browser.
 */
export function isSignInPage(url: string): boolean {
  return URL.canParse(url) && new URL(url).protocol === 'https:';
}
