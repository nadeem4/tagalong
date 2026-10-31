/**
 * The offscreen page: opens the microphone, cuts it into 512-sample 16 kHz frames with the
 * worklet and posts each one to the service worker. It cannot ask for the microphone itself, so
 * it relies on the grant made on the mic permission page; without it, it says so and stops.
 */
import type { MicMessage } from '../voice/mic-control';
import { toPcm16 } from '../voice/pcm';

function send(message: MicMessage): void {
  chrome.runtime.sendMessage(message).catch(() => undefined);
}

async function capture(): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  // 16 kHz context: Chrome resamples the mic, so frames already match what the brain hears.
  const context = new AudioContext({ sampleRate: 16_000 });
  await context.audioWorklet.addModule(new URL('./mic-worklet.js', import.meta.url).href);
  const node = new AudioWorkletNode(context, 'tagalong-mic');
  node.port.onmessage = (event: MessageEvent<Float32Array>) =>
    send({ type: 'mic:frame', pcm: Array.from(toPcm16(event.data)) });
  context.createMediaStreamSource(stream).connect(node);
}

capture().catch(() => send({ type: 'mic:failed' }));
