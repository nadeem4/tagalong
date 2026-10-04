import { join, resolve } from 'node:path';

/**
 * The only pages a renderer may ask main to open in the browser: where each provider's
 * API key is made. An allowlist rather than "any https URL", because a renderer that
 * could open anything could be talked into opening anything.
 */
const ALLOWED_LINK_ORIGINS: ReadonlySet<string> = new Set([
  'https://openrouter.ai',
  'https://tokenfactory.nebius.com',
  'https://console.anthropic.com',
]);

/** Whether a link is one of the key pages the setup wizard offers. */
export function isAllowedLink(url: string): boolean {
  if (!URL.canParse(url)) return false;
  return ALLOWED_LINK_ORIGINS.has(new URL(url).origin);
}

export interface ExtensionFolderOptions {
  packaged: boolean;
  /** `process.resourcesPath`: the installer copies the extension next to app.asar. */
  resourcesPath: string;
  /** `app.getAppPath()`: apps/desktop in a source checkout. */
  appPath: string;
  exists: (path: string) => boolean;
}

/**
 * Where the unpacked Chrome extension lives on this machine, for "Load unpacked".
 *
 * The installer ships it under resources/extension so a judge with no checkout can still
 * load it; a source checkout points at the extension's own build. Undefined when it was
 * never built, so the wizard says how to build it instead of naming a folder that is not
 * there.
 */
export function extensionFolder(options: ExtensionFolderOptions): string | undefined {
  const folder = options.packaged
    ? join(options.resourcesPath, 'extension')
    : resolve(options.appPath, '..', 'extension', 'dist');
  return options.exists(folder) ? folder : undefined;
}
