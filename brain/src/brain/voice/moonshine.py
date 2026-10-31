"""Moonshine (tiny, streaming) speech-to-text through the `moonshine-voice` package.

Frames go in as they come; `text` is every line the stream has so far; `reset` stops and
restarts the stream, which drops the words. The package downloads its own model into
`<voice folder>/moonshine`. Not unit tested (needs the real model); covered by the hand run.
"""

from collections.abc import Callable
from pathlib import Path

import numpy as np


def load(folder: Path, on_progress: Callable[[float], None] | None = None):
    from moonshine_voice import ModelArch, get_model_for_language
    from moonshine_voice.transcriber import Transcriber

    path, arch = get_model_for_language(
        "en",
        ModelArch.TINY_STREAMING,
        cache_root=folder / "moonshine",
        on_progress=(lambda fraction, _name: on_progress(fraction)) if on_progress else None,
    )
    transcriber = Transcriber(model_path=path, model_arch=arch, update_interval=0.0)
    stream = transcriber.create_stream(update_interval=0.0)
    stream.start()

    class Moonshine:
        def accept(self, frame: np.ndarray) -> None:
            stream.add_audio(frame.tolist(), 16_000)

        def text(self) -> str:
            lines = stream.update_transcription(0).lines
            return " ".join(line.text.strip() for line in lines if line.text.strip())

        def reset(self) -> None:
            stream.stop()
            stream.start()

    return Moonshine()
