"""Moonshine (streaming) speech-to-text, the live engine, through the `moonshine-voice` package.

Frames go in as they come; `text` is every line the stream has so far; `reset` stops and
restarts the stream, which drops the words; `finish` is `reset` that returns the final words.
The package downloads its own model into `<voice folder>/moonshine`. `load_live` needs the
real model and is covered by the hand run; `Moonshine` is tested on a fake stream.
"""

from collections.abc import Callable
from pathlib import Path
from typing import TYPE_CHECKING

import numpy as np

if TYPE_CHECKING:
    from brain.voice.stt import SttModel


class Moonshine:
    def __init__(self, stream) -> None:
        self._stream = stream

    def accept(self, frame: np.ndarray) -> None:
        self._stream.add_audio(frame.tolist(), 16_000)

    def text(self) -> str:
        return _join(self._stream.update_transcription(0).lines)

    def finish(self) -> str:
        # `stop` runs a last pass over everything fed. The live `text` trails it by a
        # pass, which clipped the last word ("France") and mangled others ("moon").
        final = self._stream.stop()
        self._stream.start()
        if final is None:  # Stream.stop swallows its errors; do not turn that into no words
            raise RuntimeError("the speech model's final pass failed")
        return _join(final.lines)

    def reset(self) -> None:
        self._stream.stop()
        self._stream.start()


def _join(lines) -> str:
    return " ".join(line.text.strip() for line in lines if line.text.strip())


def load_live(model: "SttModel", folder: Path, on_progress: Callable[[float], None] | None = None):
    from moonshine_voice import ModelArch, get_model_for_language
    from moonshine_voice.transcriber import Transcriber

    path, arch = get_model_for_language(
        "en",
        ModelArch[model.options["arch"]],
        cache_root=folder / "moonshine",
        on_progress=(lambda fraction, _name: on_progress(fraction)) if on_progress else None,
    )
    transcriber = Transcriber(model_path=path, model_arch=arch, update_interval=0.0)
    stream = transcriber.create_stream(update_interval=0.0)
    stream.start()
    return Moonshine(stream)
