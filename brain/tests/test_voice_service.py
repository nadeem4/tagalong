"""Tests for VoiceService: sessions per body, buffering while models load, off-loop inference."""

import asyncio

import numpy as np
from fake_voice import LOUD, parts

from brain.voice.models import ModelIntegrityError
from brain.voice.service import MAX_BUFFER_SECONDS, VoiceService

PAUSE = 8


class Sent:
    """A recording stand-in for Bodies: only the live-only send is used."""

    def __init__(self) -> None:
        self.frames: list[tuple[str, str, dict]] = []

    def send_live(self, body_id: str, method: str, params: dict) -> bool:
        self.frames.append((body_id, method, params))
        return True

    def heard(self, body_id: str = "d") -> list[str]:
        return [
            p["event"] + (":" + p["text"] if "text" in p else "")
            for b, m, p in self.frames
            if b == body_id and m == "heard"
        ]

    def voice(self, body_id: str = "d") -> list[dict]:
        return [p for b, m, p in self.frames if b == body_id and m == "voice"]


def pcm(frame: np.ndarray, times: int = 1) -> bytes:
    return np.tile((frame * 32767).astype("<i2"), times).tobytes()


def service(sent, *, load=None, p=None):
    made = p or parts()
    calls = {"n": 0}

    async def load_ears(on_progress):
        calls["n"] += 1
        if load is not None:
            return await load(on_progress, calls["n"])
        return made

    svc = VoiceService(sent, load_ears)
    return svc, made, calls


async def settle(times: int = 40):
    for _ in range(times):
        await asyncio.sleep(0.005)


async def test_frames_before_the_models_load_are_not_lost():
    sent = Sent()
    gate = asyncio.Event()

    async def slow(on_progress, n):
        await gate.wait()
        return parts()

    svc, _, _ = service(sent, load=slow)
    svc.listen("d", "held")
    svc.mic("d", pcm(LOUD, 12))  # spoken while still loading
    await settle(5)
    assert sent.heard() == []
    gate.set()
    await settle()
    assert sent.heard()[0] == "speech_start"
    svc.unlisten("d")
    await settle()
    assert sent.heard()[-1] == "turn_end:" + " ".join(["word"] * 12)


async def until(check, seconds: float = 10.0):
    end = asyncio.get_running_loop().time() + seconds
    while not check() and asyncio.get_running_loop().time() < end:
        await asyncio.sleep(0.01)


async def test_a_download_reports_loading_progress_then_ready():
    sent = Sent()

    async def download(on_progress, n):
        on_progress(0.25)
        on_progress(1.0)
        return parts()

    svc, _, _ = service(sent, load=download)
    svc.listen("d", "held")
    await settle()
    assert sent.voice() == [{"status": "loading", "progress": 0.25}, {"status": "ready"}]


async def test_loading_progress_is_thinned_to_whole_percents():
    sent = Sent()

    async def download(on_progress, n):
        for fraction in (0.1, 0.101, 0.102, 0.5, 0.505):
            on_progress(fraction)
        return parts()

    svc, _, _ = service(sent, load=download)
    svc.listen("d", "held")
    await settle()
    assert [v["progress"] for v in sent.voice() if "progress" in v] == [0.1, 0.5]


async def test_models_already_on_disk_say_ready_without_loading():
    sent = Sent()
    svc, _, _ = service(sent)
    svc.listen("d", "held")
    await settle()
    assert sent.voice() == [{"status": "ready"}]


async def test_listen_twice_supersedes_the_old_session():
    sent = Sent()
    svc, _, _ = service(sent)
    svc.listen("d", "held")
    await settle(10)
    svc.listen("d", "held")
    svc.mic("d", pcm(LOUD, 3))
    await settle()
    svc.unlisten("d")
    await settle()
    turn_ends = [e for e in sent.heard() if e.startswith("turn_end")]
    assert turn_ends == ["turn_end:word word word"]  # the old, silent session said nothing


async def test_unlisten_held_flushes_then_one_turn_end():
    sent = Sent()
    svc, _, _ = service(sent)
    svc.listen("d", "held")
    svc.mic("d", pcm(LOUD, 2))
    svc.unlisten("d")
    await settle()
    assert sent.heard()[-2:] == ["final:word word", "turn_end:word word"]
    assert sum(e.startswith("turn_end") for e in sent.heard()) == 1


async def test_unlisten_always_stops_at_once_with_no_events():
    sent = Sent()
    svc, _, _ = service(sent)
    svc.listen("d", "always")
    await settle(10)
    svc.mic("d", pcm(LOUD, 3))
    svc.unlisten("d")
    await settle()
    assert not any(e.startswith(("final", "turn_end")) for e in sent.heard())


async def test_a_mic_frame_without_a_session_or_with_odd_bytes_is_dropped():
    sent = Sent()
    svc, _, calls = service(sent)
    svc.mic("d", pcm(LOUD, 3))  # nobody listens
    svc.listen("d", "held")
    svc.mic("d", b"\x00\x01\x02")  # odd length
    await settle()
    svc.unlisten("d")
    await settle()
    assert calls["n"] == 1
    assert sent.heard() == ["turn_end:"]


async def test_a_failed_load_says_so_once_and_the_next_listen_retries():
    sent = Sent()

    async def flaky(on_progress, n):
        if n == 1:
            raise OSError("offline")
        return parts()

    svc, _, calls = service(sent, load=flaky)
    svc.listen("d", "held")
    svc.mic("d", pcm(LOUD, 2))
    await settle()
    failed = [v for v in sent.voice() if v["status"] == "failed"]
    assert len(failed) == 1 and "internet" in failed[0]["message"].lower()
    svc.mic("d", pcm(LOUD, 2))  # session is over: dropped
    svc.listen("d", "held")
    svc.mic("d", pcm(LOUD, 2))
    await settle()
    assert calls["n"] == 2
    assert sent.voice()[-1] == {"status": "ready"}
    svc.unlisten("d")
    await settle()
    assert sent.heard()[-1] == "turn_end:word word"


async def test_a_damaged_download_has_its_own_message():
    sent = Sent()

    async def damaged(on_progress, n):
        raise ModelIntegrityError("x")

    svc, _, _ = service(sent, load=damaged)
    svc.listen("d", "held")
    await settle()
    assert "damaged" in sent.voice()[-1]["message"].lower()


async def test_unlisten_for_a_body_that_never_listened_is_fine():
    svc, _, _ = service(Sent())
    svc.unlisten("nobody")
    svc.hush("nobody")


async def test_disconnect_frees_the_session():
    sent = Sent()
    svc, _, _ = service(sent)
    svc.listen("d", "always")
    await settle(10)
    svc.unlisten("d")
    await settle()
    assert svc._sessions == {}


async def test_inference_runs_off_the_event_loop():
    sent = Sent()
    p = parts()
    p.stt.sleep = 0.05  # every `text` call blocks its thread for 50 ms
    svc, _, _ = service(sent, p=p)
    ticks = 0

    async def ticker():
        nonlocal ticks
        while True:
            await asyncio.sleep(0.005)
            ticks += 1

    task = asyncio.create_task(ticker())
    svc.listen("d", "held")
    svc.mic("d", pcm(LOUD, 10))  # the tenth speech frame asks for a partial
    await until(lambda: any(e.startswith("partial") for e in sent.heard()))
    task.cancel()
    assert any(e.startswith("partial") for e in sent.heard())
    assert ticks >= 8


async def test_a_new_session_resets_the_vad_state():
    sent = Sent()
    p = parts()
    svc, _, _ = service(sent, p=p)
    svc.listen("d", "held")
    await settle(10)
    svc.listen("d", "held")
    await settle(10)
    assert p.vad.resets == 2


async def test_a_model_error_ends_a_held_turn_with_what_was_heard_and_reloads_next_time():
    sent = Sent()
    from fake_voice import LevelVad

    svc, _, calls = service(sent, p=parts(vad=LevelVad(fail_on=3)))
    svc.listen("d", "held")
    svc.mic("d", pcm(LOUD, 5))
    await settle()
    assert sent.heard()[-1].startswith("turn_end:")
    svc.listen("d", "held")
    await settle(10)
    assert calls["n"] == 2


async def test_two_bodies_listen_without_mixing():
    sent = Sent()
    svc, _, _ = service(sent)
    svc.listen("a", "held")
    svc.listen("b", "held")
    svc.mic("a", pcm(LOUD, 1))
    svc.mic("b", pcm(LOUD, 2))
    svc.unlisten("a")
    svc.unlisten("b")
    await settle()
    assert sent.heard("a")[-1] == "turn_end:word"
    assert sent.heard("b")[-1] == "turn_end:word word"


async def test_the_buffer_while_loading_keeps_only_the_newest_seconds():
    sent = Sent()
    gate = asyncio.Event()

    async def slow(on_progress, n):
        await gate.wait()
        return parts()

    svc, _, _ = service(sent, load=slow)
    svc.listen("d", "held")
    one_second = 31  # frames of 32 ms
    for _ in range(MAX_BUFFER_SECONDS + 5):
        svc.mic("d", pcm(LOUD, one_second))
    session = svc._sessions["d"]
    assert session.queued <= MAX_BUFFER_SECONDS * 16_000 + 512 * one_second
    gate.set()
    svc.unlisten("d")
    await until(lambda: any(e.startswith("turn_end") for e in sent.heard()))
    assert sent.heard()[-1].startswith("turn_end:")
