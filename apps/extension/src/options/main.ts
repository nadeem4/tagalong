import { localStorageArea } from '../chrome-adapters';
import { clearPairing, parsePairingInput, readPairing, savePairing } from '../pairing';
import { PORT_NAME } from '../port-messages';
import type { WorkerMessage } from '../port-messages';
import { describeStatus } from '../status-text';

/**
 * The pairing page. Saving writes chrome.storage.local; the service worker sees the change
 * and reconnects with the new token, so there is no "connect" step to forget.
 */
const form = document.getElementById('pairing-form') as HTMLFormElement;
const message = document.getElementById('message') as HTMLParagraphElement;
const statusLine = document.getElementById('status') as HTMLElement;
const tokenInput = form.elements.namedItem('token') as HTMLInputElement;
const portInput = form.elements.namedItem('port') as HTMLInputElement;

void readPairing(localStorageArea).then((pairing) => {
  if (pairing === null) return;
  tokenInput.value = pairing.token;
  portInput.value = String(pairing.port);
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const parsed = parsePairingInput(tokenInput.value, portInput.value);
  if (!parsed.ok) {
    message.textContent = parsed.error;
    return;
  }
  void savePairing(localStorageArea, parsed.pairing).then(() => {
    message.textContent = 'Saved. Connecting…';
  });
});

document.getElementById('forget')?.addEventListener('click', () => {
  void clearPairing(localStorageArea).then(() => {
    tokenInput.value = '';
    portInput.value = '';
    message.textContent = 'Pairing forgotten.';
  });
});

const port = chrome.runtime.connect({ name: PORT_NAME });
port.onMessage.addListener((raw: WorkerMessage) => {
  if (raw.type === 'status') statusLine.textContent = describeStatus(raw.status);
});
