// Collects the microphone into 512-sample frames (32 ms at 16 kHz) and posts each one.
// Runs on the audio thread; nothing is kept once a frame is posted. 512 samples is the frame the
// brain's ears expect (the desktop's worklet is the same); a worklet cannot import a constant.
class TagalongMic extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frame = new Float32Array(512);
    this.at = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) {
      for (let i = 0; i < channel.length; i += 1) {
        this.frame[this.at++] = channel[i];
        if (this.at === 512) {
          this.port.postMessage(this.frame);
          this.frame = new Float32Array(512);
          this.at = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('tagalong-mic', TagalongMic);
