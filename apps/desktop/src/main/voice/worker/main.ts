import { loadEars } from '../ears/load-ears';
import { EARS_FILES, ensureFiles } from '../ears/model-files';
import { loadKokoro } from '../kokoro';
import { LazyLocalVoice } from '../voice';
import { createEarsHost } from './ears-host';
import { createWorkerHandler } from './handler';
import type { ToWorker } from './messages';

// An Electron utility process: the voice models load and run here, so they never stall a window.
const dir = process.env.TAGALONG_VOICE_DIR ?? '.';
const port = process.parentPort;
const fake = process.env.TAGALONG_FAKE_STT === '1';
const handle = createWorkerHandler(
  {
    kokoro: new LazyLocalVoice(() => loadKokoro(dir)),
    ears: createEarsHost({
      fake,
      load: () => loadEars(dir),
      post: (m) => port.postMessage(m),
    }),
    // Never downloads under the fake: the e2e suite needs no model.
    ensureEars: fake
      ? async (onProgress) => onProgress(1)
      : (onProgress) => ensureFiles(dir, EARS_FILES, fetch, onProgress),
  },
  (message) => port.postMessage(message),
);
port.on('message', (event: { data: ToWorker }) => handle(event.data));
