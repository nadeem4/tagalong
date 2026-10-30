/**
 * Chrome MV3 entry point: wires the real Chrome pieces into the browser body. Every listener is
 * registered synchronously at the top level, because Chrome only delivers events to listeners
 * that exist when a stopped worker is woken.
 */
import { createBody } from './body';
import {
  chromePage,
  chromePermissions,
  chromePrompt,
  chromeSession,
  chromeStorage,
  chromeTabs,
  webSocket,
} from './layer/chromium';
import { PermissionBroker } from './permissions';
import type { WorkerQuery } from './popup/model';
import { ADDR_KEY, NAME_KEY } from './settings';

/** Wakes a stopped worker so it notices the brain coming back. */
const RECONNECT_ALARM = 'tagalong-reconnect';

// userAgentData is not in the DOM typings yet.
const brands = (
  (navigator as { userAgentData?: { brands?: { brand: string }[] } }).userAgentData?.brands ?? []
).map((b) => b.brand);

const body = createBody({
  local: chromeStorage,
  session: chromeSession,
  brands,
  userAgent: navigator.userAgent,
  tabs: chromeTabs,
  page: chromePage,
  needs: new PermissionBroker(chromePermissions, chromePrompt),
  openSocket: webSocket,
});

chrome.runtime.onInstalled.addListener(() => void body.start());
chrome.runtime.onStartup.addListener(() => void body.start());

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RECONNECT_ALARM && body.info().status !== 'online') void body.start();
});
void chrome.alarms.create(RECONNECT_ALARM, { periodInMinutes: 0.5 });

// The popup saves the address or name; the body dials again with the new values.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (ADDR_KEY in changes || NAME_KEY in changes)) void body.restart();
});

chrome.runtime.onMessage.addListener((message: Partial<WorkerQuery> | null, _sender, respond) => {
  if (message?.type !== 'status') return false;
  respond(body.info());
  return false;
});

void body.start();
