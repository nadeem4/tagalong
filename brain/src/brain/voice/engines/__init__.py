"""Engine name -> adapter. An engine is one module here; its row(s) live in `stt_models.json`.
`load.py` resolves a model through `ENGINES[model.engine]`, so a new engine touches no loader.
Adapter modules import their heavy libraries inside the `load_*` functions only.
"""

from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

from brain.voice.engines import faster_whisper, moonshine

if TYPE_CHECKING:
    from brain.voice.stt import FinalStt, LiveStt, SttModel

Progress = Callable[[float], None]


@dataclass(frozen=True)
class Engine:
    streams: bool  # can take frames as they come (a live model needs this)
    load_live: "Callable[[SttModel, Path, Progress | None], LiveStt] | None"
    load_final: "Callable[[SttModel, Path, Progress | None], FinalStt] | None"


ENGINES: dict[str, Engine] = {
    "moonshine": Engine(True, moonshine.load_live, None),
    "faster-whisper": Engine(False, None, faster_whisper.load_final),
}
