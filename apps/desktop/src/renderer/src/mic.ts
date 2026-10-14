/** Whisper listens at 16 kHz, mono. Matches main's SAMPLE_RATE. */
const RATE = 16_000;

/** One spoken question being recorded. Nothing is kept once it has been handed over. */
export interface Recording {
  /** Stops and hands back what was said, as 16 kHz mono samples. */
  stop(): Promise<Float32Array>;
  /** Stops and throws the audio away. */
  cancel(): void;
}

/**
 * Opens the microphone (the one picked in Settings, or the system default) and records
 * until stopped. Only ever called on the talk key or the mic button: never on its own.
 */
export async function startRecording(deviceId?: string): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      ...(deviceId !== undefined && deviceId !== '' ? { deviceId: { exact: deviceId } } : {}),
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
    },
  });
  const recorder = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  recorder.start();
  const release = (): void => stream.getTracks().forEach((track) => track.stop());
  return {
    stop: () =>
      new Promise<Float32Array>((resolve, reject) => {
        recorder.onstop = () => {
          release();
          toSamples(new Blob(chunks, { type: recorder.mimeType })).then(resolve, reject);
        };
        recorder.stop();
      }),
    cancel: () => {
      recorder.onstop = null;
      if (recorder.state !== 'inactive') recorder.stop();
      release();
    },
  };
}

/** Decodes the recording and resamples it to 16 kHz mono. */
async function toSamples(blob: Blob): Promise<Float32Array> {
  if (blob.size === 0) return new Float32Array(0);
  const context = new AudioContext();
  try {
    // A recording that cannot be decoded is heard as nothing said.
    const decoded = await context.decodeAudioData(await blob.arrayBuffer()).catch((error) => {
      console.warn('[mic] the recording could not be decoded', error);
      return null;
    });
    if (decoded === null) return new Float32Array(0);
    const length = Math.ceil(decoded.duration * RATE);
    if (length === 0) return new Float32Array(0);
    const offline = new OfflineAudioContext(1, length, RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    return (await offline.startRendering()).getChannelData(0).slice();
  } finally {
    void context.close();
  }
}

/** The microphones on this computer, for Settings. Names appear once one has been used. */
export async function listMicrophones(): Promise<{ id: string; label: string }[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((device) => device.kind === 'audioinput' && device.deviceId !== 'default')
    .map((device, index) => ({
      id: device.deviceId,
      label: device.label || `Microphone ${index + 1}`,
    }));
}
