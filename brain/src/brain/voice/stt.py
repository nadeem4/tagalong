"""Speech-to-text models as data: the list (`stt_models.json`), the two protocols the ears use
and the choice order. Models are rows, engines are code (`engines/`): a new model of a known
engine is a row; a new engine is one module plus rows. Heavy libraries load only in an engine.
"""

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal, Protocol

import numpy as np

from brain.voice.models import ModelFile

LIST_FILE = Path(__file__).with_name("stt_models.json")
ROLES = ("live", "final", "both")
GPUS = ("none", "preferred", "required")
AUTO = "auto"


class LiveStt(Protocol):
    def accept(self, frame: np.ndarray) -> None: ...

    def text(self) -> str: ...  # words so far; can trail the audio by a pass, fine for partials

    def finish(self) -> str: ...  # the final pass over what was fed; restarts the stream

    def reset(self) -> None: ...  # drop the words


class FinalStt(Protocol):
    def transcribe(self, audio: np.ndarray) -> str: ...  # a whole turn, 16 kHz float32


@dataclass(frozen=True)
class SttModel:
    id: str
    label: str
    role: Literal["live", "final", "both"]
    engine: str
    files: tuple[ModelFile, ...]
    size_mb: int
    gpu: Literal["none", "preferred", "required"]
    languages: tuple[str, ...]
    note: str
    options: dict[str, Any]
    # Where this row is the Auto pick: {"cpu"|"gpu": "live"|"final"} (measured, see docs).
    auto: dict[str, str] = field(default_factory=dict)


SHA256 = re.compile(r"[0-9a-f]{64}")


def _row(raw: dict, engines: dict, index: int = 0) -> SttModel:
    try:
        return _build(raw, engines)
    except KeyError as missing:
        name = raw.get("id") or f"#{index}"
        raise ValueError(f"speech model {name!r}: missing {missing.args[0]!r}") from None


def _build(raw: dict, engines: dict) -> SttModel:
    where = f"speech model {raw.get('id')!r}"
    if raw["role"] not in ROLES:
        raise ValueError(f"{where}: unknown role {raw['role']!r}")
    if raw["gpu"] not in GPUS:
        raise ValueError(f"{where}: unknown gpu setting {raw['gpu']!r}")
    engine = engines.get(raw["engine"])
    if engine is None:
        raise ValueError(f"{where}: unknown engine {raw['engine']!r}")
    if raw["role"] in ("live", "both") and not (engine.streams and engine.load_live):
        raise ValueError(f"{where}: a live model needs an engine that can stream and load live")
    files = tuple(ModelFile(**f) for f in raw["files"])
    if any(not SHA256.fullmatch(f.sha256) or f.bytes <= 0 for f in files):
        raise ValueError(f"{where}: every file needs a 64-digit lowercase hex sha256 and a size")
    auto = raw.get("auto", {})
    if any(k not in ("cpu", "gpu") or v not in ("live", "final") for k, v in auto.items()):
        raise ValueError(f"{where}: auto must map cpu or gpu to live or final")
    return SttModel(
        raw["id"],
        raw["label"],
        raw["role"],
        raw["engine"],
        files,
        raw["size_mb"],
        raw["gpu"],
        tuple(raw["languages"]),
        raw["note"],
        raw["options"],
        auto,
    )


def load_models(text: str | None = None) -> tuple[SttModel, ...]:
    from brain.voice import engines  # late: the engines import this module's protocols

    raw = json.loads(text if text is not None else LIST_FILE.read_text(encoding="utf-8"))
    rows = tuple(_row(r, engines.ENGINES, i) for i, r in enumerate(raw))
    ids = [m.id for m in rows]
    for i in ids:
        if ids.count(i) > 1:
            raise ValueError(f"speech model {i!r} is listed twice")
    return rows


def model_by_id(model_id: str) -> SttModel | None:
    return next((m for m in load_models() if m.id == model_id), None)


@dataclass(frozen=True)
class Hardware:
    gpu: bool


def detect_hardware() -> Hardware:
    # CTranslate2 (faster-whisper's engine) asks the NVIDIA driver itself, so a PC with a driver
    # but no CUDA toolkit still counts, and CUDA_VISIBLE_DEVICES=-1 hides the card. A card alone
    # is not enough: without cuBLAS the final model cannot use it (measured on the dev PC).
    # Callers on the event loop run this in a thread (the first import is slow).
    import ctypes.util

    try:
        import ctranslate2

        cards = ctranslate2.get_cuda_device_count() > 0
    except Exception:
        return Hardware(gpu=False)
    libs = ctypes.util.find_library("cublas64_12") or ctypes.util.find_library("cublas")
    return Hardware(gpu=cards and libs is not None)


@dataclass(frozen=True)
class Resolved:
    live: SttModel
    final: SttModel | None


def _pick(saved: str | None, env: str | None) -> str:
    # Saved wins; the env value is the default for a machine with no screen. Auto is neither.
    return saved or env or AUTO


def auto_pick(listed: tuple[SttModel, ...], role: str, hardware: Hardware) -> SttModel | None:
    """The row whose `auto` hint names this role for this hardware (the list is the rule)."""
    key = "gpu" if hardware.gpu else "cpu"
    return next((m for m in listed if m.auto.get(key) == role), None)


def resolve(
    saved_live: str | None,
    saved_final: str | None,
    env_live: str | None,
    env_final: str | None,
    hardware: Hardware,
) -> Resolved:
    """The models to load. A missing, stale or wrong-role id is Auto: the rows' `auto` hints for
    this hardware. `same` and `off` (and any other non-model) mean no final pass."""
    listed = load_models()
    live_id = _pick(saved_live, env_live)
    live = next((m for m in listed if m.id == live_id and m.role in ("live", "both")), None)
    if live is None:
        live = auto_pick(listed, "live", hardware)
        assert live is not None, "stt_models.json has no Auto live row"
    final_id = _pick(saved_final, env_final)
    if final_id == AUTO:
        final = auto_pick(listed, "final", hardware)
    else:
        final = next((m for m in listed if m.id == final_id and m.role in ("final", "both")), None)
    return Resolved(live, final)
