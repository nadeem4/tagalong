/**
 * The mic permission page's glue: on a click, asks Chrome for the microphone once, lets go of it
 * at once, and tells the person to go back to the popup. Chrome remembers the grant for the
 * extension, which is what the offscreen page then uses.
 */
import '@fontsource/onest/latin-400.css';
import '@fontsource/onest/latin-600.css';

const allow = document.getElementById('allow') as HTMLButtonElement;
const result = document.getElementById('result') as HTMLElement;

allow.addEventListener('click', () => {
  navigator.mediaDevices.getUserMedia({ audio: true }).then(
    (stream) => {
      for (const track of stream.getTracks()) track.stop();
      allow.hidden = true;
      result.textContent = 'Microphone allowed. Close this tab and click "Ask by voice" again.';
    },
    () => {
      result.textContent =
        "The microphone is blocked. Allow it for Tagalong in the browser's site settings, then try again.";
    },
  );
});
