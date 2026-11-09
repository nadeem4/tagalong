"""Moonshine adapter over a fake stream: the final pass must not fail silently."""

from types import SimpleNamespace

import pytest

from brain.voice.moonshine import Moonshine


class FakeStream:
    def __init__(self, final) -> None:
        self.final = final
        self.starts = 0

    def stop(self):
        return self.final

    def start(self) -> None:
        self.starts += 1


def test_finish_returns_the_final_words_and_restarts():
    line = SimpleNamespace(text=" hello ")
    stream = FakeStream(SimpleNamespace(lines=[line]))
    assert Moonshine(stream).finish() == "hello"
    assert stream.starts == 1


def test_finish_raises_when_the_final_pass_failed():
    stream = FakeStream(None)  # Stream.stop swallows its errors and returns None
    with pytest.raises(RuntimeError):
        Moonshine(stream).finish()
    assert stream.starts == 1  # the stream is usable again
