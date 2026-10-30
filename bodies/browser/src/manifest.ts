/**
 * The extension's manifest as data, so a test can hold it to its permission list. The build
 * writes it to `dist/manifest.json`; Chrome reads that file once, at load.
 */
export const manifest = {
  manifest_version: 3,
  name: 'Tagalong',
  description:
    'Scout, your Tagalong companion, reads pages and manages tabs when needed, and you can ask it from a page. Needs the Tagalong brain.',
  version: '0.0.0',
  minimum_chrome_version: '116',
  background: { service_worker: 'service-worker.js', type: 'module' },
  // The popup is where the person sees the link and the grants; there is no side panel.
  action: { default_title: 'Tagalong', default_popup: 'popup/popup.html' },
  /**
   * Only what shows no browser warning: `storage` for the id and settings, `scripting` to read a
   * page, `alarms` so a stopped worker wakes to reconnect.
   */
  permissions: ['alarms', 'scripting', 'storage'],
  /**
   * Everything else is asked for the first time a tool needs it, from a click on an extension
   * page (never the worker), and kept once granted.
   */
  optional_permissions: [
    'tabs',
    'history',
    'bookmarks',
    'downloads',
    'sessions',
    'readingList',
    'tabGroups',
    'contextMenus',
    'search',
  ],
  optional_host_permissions: ['<all_urls>'],
  // Typing `scout` then a question in the address bar; the keyword needs no permission.
  omnibox: { keyword: 'scout' },
  /**
   * Extension pages and the worker may open websockets only: the brain can run on another
   * machine, so any host, but never a plain fetch of page text to somewhere else.
   */
  content_security_policy: {
    extension_pages: "script-src 'self'; object-src 'self'; connect-src ws:",
  },
} as const;
