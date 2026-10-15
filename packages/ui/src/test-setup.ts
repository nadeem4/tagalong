import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// Vitest globals are off in this repo, so Testing Library cannot register its own
// cleanup hook and rendered trees would pile up across tests.
afterEach(cleanup);

// findBy/waitFor give up after 1s by default, which a loaded CI runner can spend on one
// render; a miss then surfaces as a confusing failure in the next synchronous query.
configure({ asyncUtilTimeout: 5000 });

// jsdom has HTMLDialogElement but not its modal methods. Opening sets `open`, which is what
// makes the dialog visible to queries; the browser's focus trap and inert page are its own.
if (typeof HTMLDialogElement.prototype.showModal !== 'function') {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
}
