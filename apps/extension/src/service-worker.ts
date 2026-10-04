/**
 * Chrome MV3 host entry point: the glue between Chrome's APIs and the tested modules.
 *
 * This host never imports @tagalong/core. It speaks the protocol over the loopback
 * websocket and nothing else. Every listener is registered synchronously at the top
 * level, because Chrome only delivers events to listeners that exist when a stopped
 * worker is woken.
 */
import { PerceptionCaptureParams } from '@tagalong/protocol';
import { chromeTabAccess, localStorageArea } from './chrome-adapters';
import { EngineConnection } from './engine-connection';
import { PAIRING_KEY, readPairing } from './pairing';
import { PortHub } from './port-hub';
import { PORT_NAME } from './port-messages';
import { EXTENSION_CAPABILITIES } from './capabilities';
import { COMMAND_OPEN_PANEL } from './manifest';
import { PAGE_TARGETS } from './page-targets';
import { captureSnapshot, captureTab } from './tab-capture';

/** Wakes a stopped worker so it notices the desktop app coming back. */
const RECONNECT_ALARM = 'tagalong-reconnect';

const connection = new EngineConnection({
  readPairing: () => readPairing(localStorageArea),
  createSocket: (url) => new WebSocket(url),
  hostVersion: chrome.runtime.getManifest().version,
  capabilities: EXTENSION_CAPABILITIES,
  answer: async (method, params) => {
    // The only request this host answers. The engine sends readText and the rest to hosts
    // that advertise them, and the extension advertises none of those.
    if (method !== 'perception.capture') throw new Error(`the extension does not answer ${method}`);
    const { what } = PerceptionCaptureParams.parse(params);
    return { snapshot: await captureTab(what, chromeTabAccess) };
  },
  onNotification: (method, params) => hub.broadcast({ type: 'notification', method, params }),
  onStatus: (status) => hub.broadcast({ type: 'status', status }),
});

const hub = new PortHub({
  status: () => connection.status,
  call: (method, params) => connection.call(method, params as never),
  capture: (targets) => captureSnapshot(targets, chromeTabAccess),
});

// The toolbar button opens the side panel. It is also the user gesture that grants
// activeTab, which is what lets the panel read the page it was opened on.
void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PORT_NAME) return;
  hub.add(port);
  void connection.start();
});

// The shortcut. Opening the panel has to happen inside the command's user gesture, so it
// comes before anything awaited; the capture follows and reaches the panel when it connects.
chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== COMMAND_OPEN_PANEL || tab?.windowId === undefined) return;
  void chrome.sidePanel.open({ windowId: tab.windowId });
  captureSnapshot(PAGE_TARGETS, chromeTabAccess)
    .then((snapshot) => hub.publishContext(snapshot))
    .catch(() => undefined);
});

// A panel stays open across tab switches, so it is told about the tab it now sits beside.
// Without the optional all-sites grant the new tab usually cannot be read, and the chip is
// cleared rather than left naming the previous page.
chrome.tabs.onActivated.addListener(() => {
  if (!hub.hasPages) return;
  captureSnapshot(PAGE_TARGETS, chromeTabAccess)
    .then((snapshot) => hub.publishContext(snapshot))
    .catch(() => hub.publishContext(null));
});

// Pairing is the one setup step, so a fresh install lands on the page that does it.
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') void chrome.runtime.openOptionsPage();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && PAIRING_KEY in changes) void connection.restart();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RECONNECT_ALARM) void connection.start();
});
void chrome.alarms.create(RECONNECT_ALARM, { periodInMinutes: 0.5 });

void connection.start();
