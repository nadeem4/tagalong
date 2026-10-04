/**
 * Chrome MV3 host entry point: the glue between Chrome's APIs and the tested modules.
 *
 * This host never imports @tagalong/core. It speaks the protocol over the loopback
 * websocket and nothing else. Every listener is registered synchronously at the top
 * level, because Chrome only delivers events to listeners that exist when a stopped
 * worker is woken.
 */
import { localStorageArea } from './chrome-adapters';
import { EngineConnection } from './engine-connection';
import { PAIRING_KEY, readPairing } from './pairing';
import { PortHub } from './port-hub';
import { PORT_NAME } from './port-messages';
import { EXTENSION_CAPABILITIES } from './capabilities';

/** Wakes a stopped worker so it notices the desktop app coming back. */
const RECONNECT_ALARM = 'tagalong-reconnect';

const connection = new EngineConnection({
  readPairing: () => readPairing(localStorageArea),
  createSocket: (url) => new WebSocket(url),
  hostVersion: chrome.runtime.getManifest().version,
  capabilities: EXTENSION_CAPABILITIES,
  answer: (method) => Promise.reject(new Error(`${method} is not answered by the extension yet`)),
  onNotification: (method, params) => hub.broadcast({ type: 'notification', method, params }),
  onStatus: (status) => hub.broadcast({ type: 'status', status }),
});

const hub = new PortHub({
  status: () => connection.status,
  call: (method, params) => connection.call(method, params as never),
  capture: () => Promise.resolve(null),
});

// The toolbar button opens the side panel. It is also the user gesture that grants
// activeTab, which is what lets the panel read the page it was opened on.
void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PORT_NAME) return;
  hub.add(port);
  void connection.start();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && PAIRING_KEY in changes) void connection.restart();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RECONNECT_ALARM) void connection.start();
});
void chrome.alarms.create(RECONNECT_ALARM, { periodInMinutes: 0.5 });

void connection.start();
