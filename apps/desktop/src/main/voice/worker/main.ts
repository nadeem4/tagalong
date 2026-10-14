import { loadKokoro } from '../kokoro';
import { LazyLocalVoice } from '../voice';
import { createWorkerHandler } from './handler';
import type { ToWorker } from './messages';

// An Electron utility process: the voice models load and run here, so they never stall a window.
const dir = process.env.TAGALONG_VOICE_DIR ?? '.';
const port = process.parentPort;
const handle = createWorkerHandler(
  { kokoro: new LazyLocalVoice(() => loadKokoro(dir)) },
  (message) => port.postMessage(message),
);
port.on('message', (event: { data: ToWorker }) => handle(event.data));
