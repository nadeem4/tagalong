/**
 * The extension's manifest, as data, so a test can hold it to the phase's permission list.
 *
 * The build writes this object to `dist/manifest.json`. Nothing here is computed at runtime:
 * Chrome reads the file once, at load.
 */

/** The command id the service worker listens for. */
export const COMMAND_OPEN_PANEL = 'open-tagalong';

export const manifest = {
  manifest_version: 3,
  name: 'Tagalong',
  description: 'Your Tagalong crew in the browser: exact selections, page text, and a side panel.',
  version: '0.0.0',
  minimum_chrome_version: '116',
  background: { service_worker: 'service-worker.js', type: 'module' },
  action: { default_title: 'Open Tagalong' },
  side_panel: { default_path: 'sidepanel.html' },
  options_ui: { page: 'options.html', open_in_tab: true },
  /**
   * `activeTab` rather than host permissions: the extension may read a page only after the
   * user has acted on it — the toolbar button, the shortcut, or the side panel. A standing
   * `<all_urls>` grant would let a pet read any tab at any moment, which is not what the
   * user agreed to by installing a side panel.
   *
   * `alarms` is the one addition to the phase's list. Chrome stops an idle service worker
   * after thirty seconds, and with it the reconnect timer; an alarm wakes the worker so it
   * notices the desktop app coming back even with no panel open. It shows the user no
   * permission prompt.
   */
  permissions: ['activeTab', 'alarms', 'scripting', 'sidePanel', 'storage'],
  /** Requested only if a later feature needs it; nothing in Phase 6 reads the clipboard. */
  optional_permissions: ['clipboardRead'],
  /**
   * Off until the user turns it on from the options page. `activeTab` covers the tab the
   * panel or shortcut was used on; this covers the rest — a tab switched to with the panel
   * open, and the desktop hotkey pressed over a tab the extension was never clicked on.
   * Still read only when the user asks: nothing is injected without an ask.
   */
  optional_host_permissions: ['<all_urls>'],
  /**
   * Extension pages and the service worker may open sockets to the loopback engine and
   * nowhere else. MV3 leaves `connect-src` open by default; closing it means a bug or a
   * compromised dependency cannot ship page text off the machine.
   */
  content_security_policy: {
    extension_pages: "script-src 'self'; object-src 'self'; connect-src ws://127.0.0.1:*",
  },
  commands: {
    [COMMAND_OPEN_PANEL]: {
      /**
       * Not Ctrl+Shift+Space, which the phase page names: that is the desktop app's global
       * ask hotkey, and a global shortcut is taken before Chrome ever sees the key. The
       * extension cannot run without the desktop app, so the phase's key would never
       * reach it. The user can rebind it at chrome://extensions/shortcuts.
       */
      suggested_key: { default: 'Alt+Shift+Space' },
      description: 'Open Tagalong with the selection attached',
    },
  },
} as const;
