/**
 * The voice process's entry point, an Electron utility process: the voice models load and run here
 * so they never stall a window.
 */

import { loadEars } from '../ears/load-ears';
import { EARS_FILES, filesPresent, KOKORO_FILES, sharedEnsureFiles } from '../ears/model-files';
import { loadKokoro } from '../kokoro';
import { forwardConsole } from '../../log-text';
import { LazyLocalVoice } from '../voice';
import { createEarsHost } from './ears-host';
import { createWorkerHandler } from './handler';
import type { ToWorker } from './messages';

const dir = process.env.TAGALONG_VOICE_DIR ?? '.';
const port = process.parentPort;
// Warnings and errors reach main's log file.
forwardConsole((level, text) => port.postMessage({ kind: 'log', level, text }));
const fake = process.env.TAGALONG_FAKE_STT === '1';
// One download of the ears' files at a time, whether Settings or the first listen asked.
// Every model file is checked against its pinned SHA-256 once per process before it is used.
const ensureEarsFiles = sharedEnsureFiles(dir, EARS_FILES);
const ensureKokoroFiles = sharedEnsureFiles(dir, KOKORO_FILES);
const handle = createWorkerHandler(
  {
    kokoro: new LazyLocalVoice(() => loadKokoro(dir, () => ensureKokoroFiles())),
    ears: createEarsHost({
      fake,
      load: () => loadEars(dir, () => ensureEarsFiles()),
      post: (m) => port.postMessage(m),
      filesPresent: () => filesPresent(dir, EARS_FILES),
    }),
    // Never downloads under the fake: the e2e suite needs no model.
    ensureEars: fake
      ? async (onProgress) => onProgress(1)
      : (onProgress) => ensureEarsFiles(onProgress),
  },
  (message) => port.postMessage(message),
);
port.on('message', (event: { data: ToWorker }) => handle(event.data));
