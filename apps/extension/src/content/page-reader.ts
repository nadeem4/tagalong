/**
 * The injected entry point. Installs the reader on the page's isolated world, where the
 * service worker's second `executeScript` call finds it.
 *
 * Nothing runs until the worker asks: there is no standing content script, so a page the
 * user never invoked Tagalong on is never touched.
 */
import { readPage } from './read-page';

declare global {
  var __tagalongReadPage: (() => ReturnType<typeof readPage>) | undefined;
}

globalThis.__tagalongReadPage = () => readPage(document, window);
