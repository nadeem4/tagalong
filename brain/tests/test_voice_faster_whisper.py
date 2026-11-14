"""The faster-whisper adapter on a fake WhisperModel: no library, no weights, no network."""

from pathlib import Path
from types import SimpleNamespace

import numpy as np

from brain.voice import stt
from brain.voice.engines import ENGINES, faster_whisper


class FakeWhisper:
    made: list[tuple] = []
    fail_cuda = False
    fail_cuda_transcribe = False
    segments = ["  Hello ", "there.  "]

    def __init__(self, path, device, compute_type):
        if device == "cuda" and FakeWhisper.fail_cuda:
            raise RuntimeError("cublas64_12.dll not found")
        FakeWhisper.made.append((path, device, compute_type))
        self.calls: list[dict] = []
        self.device = device

    def transcribe(self, audio, **kwargs):
        if self.device == "cuda" and FakeWhisper.fail_cuda_transcribe:
            raise RuntimeError("cublas64_12.dll not found")
        self.calls.append(kwargs)
        return iter(SimpleNamespace(text=t) for t in self.segments), None


def setup_function():
    FakeWhisper.made = []
    FakeWhisper.fail_cuda = False
    FakeWhisper.fail_cuda_transcribe = False


def row(**options):
    found = stt.model_by_id("whisper-large-v3-turbo")
    assert found is not None
    return found if not options else stt.SttModel(**{**found.__dict__, "options": options})


def load(model=None, folder=Path("v"), gpu=False):
    return faster_whisper.load_final(model or row(), folder, whisper=FakeWhisper, gpu=gpu)


def test_the_final_engine_is_registered_and_does_not_stream():
    engine = ENGINES["faster-whisper"]
    assert not engine.streams and engine.load_final is not None and engine.load_live is None


def test_the_list_has_two_final_rows():
    for model_id in ("whisper-large-v3-turbo", "whisper-small-en"):
        found = stt.model_by_id(model_id)
        assert found is not None and found.role == "final" and found.gpu == "preferred"


def test_joins_segments_and_strips():
    assert load().transcribe(np.zeros(16_000, dtype=np.float32)) == "Hello there."


def test_decodes_plainly_over_audio_silero_already_cut():
    model = load()
    model.transcribe(np.zeros(10, dtype=np.float32))
    assert model._model.calls == [
        {"language": None, "beam_size": 1, "vad_filter": False, "condition_on_previous_text": False}
    ]


def test_language_comes_from_the_row():
    model = load(row(language="en"))
    model.transcribe(np.zeros(10, dtype=np.float32))
    assert model._model.calls[0]["language"] == "en"


def test_uses_cuda_when_gpu_present():
    load(gpu=True)
    assert FakeWhisper.made[0][1:] == ("cuda", "float16")


def test_uses_cpu_int8_without_a_gpu():
    load(gpu=False)
    assert FakeWhisper.made[0][1:] == ("cpu", "int8")


def test_cuda_failure_falls_back_to_cpu_int8_once(caplog):
    FakeWhisper.fail_cuda = True
    load(gpu=True)
    assert [m[1:] for m in FakeWhisper.made] == [("cpu", "int8")]
    assert sum("graphics card" in r.getMessage() for r in caplog.records) == 1


def test_cuda_that_loads_but_cannot_transcribe_falls_back_to_cpu_int8(caplog):
    # CTranslate2 loads fine and only fails on the first decode when a CUDA library is missing.
    FakeWhisper.fail_cuda_transcribe = True
    engine = load(gpu=True)
    assert [m[1:] for m in FakeWhisper.made] == [("cuda", "float16"), ("cpu", "int8")]
    assert engine.transcribe(np.zeros(16000, np.float32)) == "Hello there."
    assert sum("graphics card" in r.getMessage() for r in caplog.records) == 1


def test_does_not_use_library_download(tmp_path):
    # The path is the verified folder the loader downloaded into, never a model name the
    # library would fetch by itself (that would skip the SHA-256 check).
    load(folder=tmp_path)
    assert FakeWhisper.made[0][0] == str(tmp_path / "stt" / "whisper-large-v3-turbo")
