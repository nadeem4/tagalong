"""Presence: a plain record of what the person is doing and what Scout's speech is doing.
Which body they last touched, what each body has heard of the reply it plays, whether a
sentence break went by, and the latest focus, tab and download facts. No queue and no turns:
the runner reads it and is poked through `on_change` when speech moves.
"""

from collections.abc import Callable
from datetime import datetime

from brain.bodies import Bodies


class Presence:
    def __init__(self, bodies: Bodies, now: Callable[[], datetime]) -> None:
        self._bodies = bodies
        self._now = now
        self.on_change: Callable[[], None] = lambda: None  # the runner's poke
        # The body that plays the audio is the truth about speech while it reports; the brain's
        # own mouth speaks for a body with no audio, or none connected.
        self._reported: dict[str, str] = {}  # body id -> its last state; idle is not kept
        self._mouth = "idle"
        self._heard: dict[str, tuple[str, int]] = {}  # body id -> (turn, sentences it finished)
        self._break_seen = False
        self._touched: dict[str, datetime] = {}
        self._latest: dict[str, dict[str, dict]] = {}  # kind -> source -> payload

    def speech(
        self, body_id: str, state: str, turn: str | None = None, n: int | None = None
    ) -> None:
        """A body's speech state (`talking`, `sentence_break`, `paused`, `idle`). `idle` means it
        has nothing left, so its claim ends and the mouth speaks for any other body."""
        self._reported.pop(body_id, None)
        if state != "idle":
            self._reported[body_id] = state
        if state == "sentence_break":
            if turn is not None and n is not None:
                self._heard[body_id] = (turn, n)
            self._break_seen = True
        self.on_change()

    def mouth(self, state: str) -> None:
        """The mouth's own state, followed only while no body reports one."""
        self._mouth = state
        if state == "sentence_break" and not self._reported:
            self._break_seen = True
        self.on_change()

    def speech_gone(self, body_id: str) -> None:
        """A body left or said hello again: what it last reported no longer holds."""
        self._reported.pop(body_id, None)
        self.on_change()

    def talking(self) -> bool:
        # The body that reported last is the one playing now; with none reporting, the mouth.
        return next(reversed(self._reported.values()), self._mouth) != "idle"

    def at_break(self) -> bool:
        """Whether the speech playing now sits between two sentences."""
        return next(reversed(self._reported.values()), self._mouth) == "sentence_break"

    def heard(self, body_id: str) -> tuple[str, int]:
        """The turn and how many of its sentences the body last reported finished."""
        return self._heard.get(body_id, ("", 0))

    def break_seen(self) -> bool:
        """Whether a sentence break went by since the last look. Two frames can arrive with no
        look between, so the break is latched; reading it spends it."""
        seen, self._break_seen = self._break_seen, False
        return seen

    def record(self, kind: str, source: str, payload: dict) -> None:
        """Keep the newest fact of a kind that never wakes (focus, tab, download), per source:
        each body's own focus must not overwrite another's."""
        self._latest.setdefault(kind, {})[source] = payload

    def latest(self, kind: str) -> dict[str, dict]:
        return dict(self._latest.get(kind, {}))

    def touch(self, body_id: str) -> None:
        """The person did something on this body (a say, an answer, back, focus)."""
        self._touched.pop(body_id, None)  # re-inserted last, so equal times keep the newest
        self._touched[body_id] = self._now()

    def using_now(self) -> str | None:
        online = [(at, b) for b, at in reversed(self._touched.items()) if self._bodies.is_online(b)]
        return max(online, key=lambda t: t[0])[1] if online else None
