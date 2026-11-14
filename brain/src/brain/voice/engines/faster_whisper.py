"""faster-whisper (CTranslate2), the final engine: it hears a whole turn again at its end.

`FasterWhisper.transcribe` joins the segments' text. Silero already cut the audio, so the
model's own voice filter is off, and earlier text is not fed back (it can make Whisper loop).
`load_final` runs from the verified folder `ensure_files` filled, never from a library download,
so the SHA-256 check holds. The library is imported only there; tests pass a fake `whisper`.
"""

import logging
from collections.abc import Callable
from pathlib import Path
from typing import TYPE_CHECKING

import numpy as np

if TYPE_CHECKING:
    from brain.voice.stt import SttModel

log = logging.getLogger("brain")


class FasterWhisper:
    def __init__(self, model, language: str | None) -> None:
        self._model = model
        self._language = language

    def transcribe(self, audio: np.ndarray) -> str:
        segments, _info = self._model.transcribe(
            audio,
            language=self._language,
            beam_size=1,
            vad_filter=False,
            condition_on_previous_text=False,
        )
        return " ".join(t for s in segments if (t := s.text.strip())).strip()


def load_final(
    model: "SttModel",
    folder: Path,
    on_progress: Callable[[float], None] | None = None,
    *,
    whisper=None,
    gpu: bool | None = None,
) -> FasterWhisper:
    if whisper is None:
        from faster_whisper import WhisperModel as whisper
    if gpu is None:
        from brain.voice.stt import detect_hardware

        gpu = detect_hardware().gpu
    path = str(folder / Path(model.files[0].path).parent)
    loaded = None
    if gpu:
        try:
            loaded = whisper(path, device="cuda", compute_type="float16")
            # A missing CUDA library often shows only at the first decode; the segments are
            # lazy, so consume them to find out now rather than mid-turn.
            list(loaded.transcribe(np.zeros(16000, np.float32), language="en", beam_size=1)[0])
        except Exception:
            loaded = None
            # Usually the CUDA libraries are missing; say it once and carry on with the processor.
            log.warning(
                "the graphics card could not run the final speech model; using the processor"
            )
    if loaded is None:
        loaded = whisper(path, device="cpu", compute_type="int8")
    return FasterWhisper(loaded, model.options.get("language"))
