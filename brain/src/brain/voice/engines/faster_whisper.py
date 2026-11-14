"""faster-whisper (CTranslate2), the final engine: it hears a whole turn again at its end.

`FasterWhisper.transcribe` joins the segments' text. Silero already cut the audio, so the
model's own voice filter is off, and earlier text is not fed back (it can make Whisper loop).
`load_final` runs from the verified folder `ensure_files` filled, never from a library download,
so the SHA-256 check holds. The library is imported only there; tests pass a fake `whisper`.
The card is tried only after `probe_cuda` (a child process) says it works. If it does not, the
processor is used only when `cpu_ok`; a row Auto picked for the card alone gets no model.
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
    def __init__(self, model, language: str | None, device: str = "cpu") -> None:
        self._model = model
        self._language = language
        self.device = device  # where it really runs, whatever was asked for

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
    cpu_ok: bool = True,
    *,
    whisper=None,
    gpu: bool | None = None,
    probe=None,
) -> FasterWhisper:
    from brain.voice import cuda

    cuda.add_dll_directory(folder / "cuda")  # before CTranslate2 is imported or loads a model
    if whisper is None:
        from faster_whisper import WhisperModel as whisper
    if gpu is None:
        from brain.voice.stt import detect_hardware

        gpu = detect_hardware(folder / "cuda").gpu
    path = str(folder / Path(model.files[0].path).parent)
    loaded = None
    device = "cpu"
    if gpu and (probe or cuda.probe_cuda)(folder, path):
        try:
            loaded = whisper(path, device="cuda", compute_type="float16")
            device = "cuda"
            # A missing CUDA library often shows only at the first decode; the segments are
            # lazy, so consume them to find out now rather than mid-turn.
            list(loaded.transcribe(np.zeros(16000, np.float32), language="en", beam_size=1)[0])
        except Exception:
            loaded = None
            device = "cpu"
            # Usually the CUDA libraries are missing; say it once and carry on with the processor.
            log.warning(
                "the graphics card could not run the final speech model; using the processor"
            )
    if loaded is None:
        if not cpu_ok:  # Auto picked this row for the card; the processor would be too slow
            raise RuntimeError("the graphics card cannot run the final speech model")
        loaded = whisper(path, device="cpu", compute_type="int8")
    return FasterWhisper(loaded, model.options.get("language"), device)
