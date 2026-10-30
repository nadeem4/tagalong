/**
 * The toolbar popup's glue: asks the worker for the brain status, saves the address and name
 * into storage (the worker restarts on the change), and lists what Scout may do with a Remove
 * button each. The logic worth testing lives in model.ts.
 */
import type { WorkerStatus } from '../body';
import { browserName, detectBrowser } from '../identity';
import { chromeStorage as storage } from '../layer/chromium';
import { originPattern } from '../permissions';
import { DEFAULT_ADDR, readSettings, saveAddr, saveName } from '../settings';
import {
  ALL_SITES,
  grantRows,
  showContextMenusOffer,
  statusLine,
  type GrantRow,
  type WorkerQuery,
} from './model';

const statusEl = document.getElementById('status') as HTMLElement;
const addrEl = document.getElementById('addr') as HTMLInputElement;
const addrError = document.getElementById('addr-error') as HTMLElement;
const nameEl = document.getElementById('name') as HTMLInputElement;
const grantsEl = document.getElementById('grants') as HTMLElement;
const grantsEmpty = document.getElementById('grants-empty') as HTMLElement;
const rightClickEl = document.getElementById('right-click') as HTMLButtonElement;

async function showStatus(): Promise<void> {
  const query: WorkerQuery = { type: 'status' };
  try {
    const worker = (await chrome.runtime.sendMessage(query)) as WorkerStatus | undefined;
    if (worker) statusEl.textContent = statusLine(worker.status);
  } catch {
    statusEl.textContent = statusLine('offline');
  }
}

function remove(row: GrantRow): Promise<boolean> {
  const { need } = row;
  if (need.kind === 'permission') return chrome.permissions.remove({ permissions: [need.name] });
  const pattern = need.origin === ALL_SITES ? ALL_SITES : originPattern(need.origin);
  return chrome.permissions.remove({ origins: [pattern] });
}

async function showGrants(): Promise<void> {
  const all = await chrome.permissions.getAll();
  const rows = grantRows({ permissions: all.permissions ?? [], origins: all.origins ?? [] });
  grantsEl.replaceChildren(
    ...rows.map((row) => {
      const item = document.createElement('li');
      const label = document.createElement('span');
      label.textContent = row.label;
      const button = document.createElement('button');
      button.textContent = 'Remove';
      button.setAttribute('aria-label', `Remove ${row.label}`);
      button.addEventListener('click', () => {
        // A refused remove must not leave the list stale, so refresh either way.
        remove(row)
          .catch(() => false)
          .finally(() => void showGrants());
      });
      item.append(label, button);
      return item;
    }),
  );
  grantsEmpty.hidden = rows.length > 0;
  rightClickEl.hidden = !showContextMenusOffer(all.permissions ?? []);
}

async function init(): Promise<void> {
  const settings = await readSettings(storage);
  addrEl.value = settings.addr;
  addrEl.placeholder = DEFAULT_ADDR;
  nameEl.value = settings.name ?? '';
  // userAgentData is not in the DOM typings yet.
  const data = (navigator as { userAgentData?: { brands: { brand: string }[] } }).userAgentData;
  const brands = (data?.brands ?? []).map((b) => b.brand);
  nameEl.placeholder = browserName(detectBrowser(brands, navigator.userAgent));

  addrEl.addEventListener('change', () => {
    void saveAddr(storage, addrEl.value).then((ok) => {
      addrError.hidden = ok;
      addrError.textContent = ok ? '' : 'That is not an address like 127.0.0.1:47321';
    });
  });
  nameEl.addEventListener('change', () => void saveName(storage, nameEl.value));
  // The request has to run inside this click; the worker adds the menu item when it is granted.
  rightClickEl.addEventListener('click', () => {
    chrome.permissions
      .request({ permissions: ['contextMenus'] })
      .catch(() => false)
      .finally(() => void showGrants());
  });

  await Promise.all([showStatus(), showGrants()]);
}

init().catch(() => {
  statusEl.textContent = statusLine('offline');
});
