/**
 * The permission window's glue: shows what Scout wants and why, and on a click asks Chrome.
 * chrome.permissions.request must run inside the click handler, which is why this is a page.
 */
import { buttonsFor, chromeRequestFor, parseRequest, type Scope } from './model';
import { denial } from '../permissions';

const req = parseRequest(location.search);
const title = document.getElementById('title') as HTMLElement;
const reason = document.getElementById('reason') as HTMLElement;
const buttons = document.getElementById('buttons') as HTMLElement;

function answer(id: string, granted: boolean): void {
  // Close only after the message is delivered, so the worker never sees "closed" first.
  void chrome.runtime
    .sendMessage({ type: 'permission-answer', id, granted })
    .catch(() => undefined)
    .then(() => window.close());
}

if (req === null) {
  reason.textContent = 'This permission request is not valid.';
} else {
  const { id, need } = req;
  title.textContent = need.kind === 'site' ? 'Scout wants to read a page' : 'Scout wants to help';
  // The reason is the tool's own text plus the page title, so a page can shape it; only ever set
  // as text, never as markup.
  reason.textContent = `Scout wants to ${req.reason}. If you say no, ${denial(need)}.`;
  for (const { label, scope } of buttonsFor(need)) {
    const button = document.createElement('button');
    button.textContent = label;
    button.addEventListener('click', () => onChoose(id, scope));
    buttons.append(button);
  }
}

function onChoose(id: string, scope: Scope): void {
  if (req === null) return;
  const request = chromeRequestFor(req.need, scope);
  if (request === null) return answer(id, false);
  chrome.permissions.request(request as chrome.permissions.Permissions).then(
    (granted) => answer(id, granted),
    () => answer(id, false),
  );
}
