/**
 * The injected entry point. Installs the readers on the page's isolated world, where the
 * service worker's second `executeScript` call finds them.
 *
 * Nothing runs until the worker asks: there is no standing content script, so a page the
 * user never invoked Tagalong on is never touched.
 */
import { readParts, type PartKind } from './page-parts';
import { readPage } from './read-page';

declare global {
  var __tagalongReadPage: (() => ReturnType<typeof readPage>) | undefined;
  var __tagalongReadParts: ((kind: PartKind) => string) | undefined;
}

globalThis.__tagalongReadPage = () => readPage(document, window);
globalThis.__tagalongReadParts = (kind) => readParts(document, kind);
