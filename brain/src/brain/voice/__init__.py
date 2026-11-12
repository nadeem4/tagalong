"""The seam between the brain and its voice models.

The server routes `listen`, `mic`, `unlisten` and `hush` here; the session reports spoken turns
(`spoken`, `reply`, `turn_ended`), asks for a turn's `sentences` and, for an interjection, takes
the queue (`speaking`, `pause`, `replace`, `resume`);
Home asks for a `sample`. Neither knows about models.
"""

from typing import Literal, Protocol


class VoiceHooks(Protocol):
    def listen(self, body_id: str, mode: Literal["held", "always"]) -> None: ...

    def mic(self, body_id: str, pcm: bytes) -> None: ...

    def unlisten(self, body_id: str) -> None: ...

    def hush(self, body_id: str) -> None: ...

    def spoken(
        self,
        turn: str,
        body_id: str,
        voice: str | None,
        speed: float | None,
        system_voice: bool = False,
    ) -> None: ...

    def reply(self, turn: str, body_id: str | None, params: dict) -> None: ...

    def turn_ended(self, turn: str) -> None: ...

    def sentences(self, turn: str) -> list[str]: ...

    def speaking(self, turn: str, body_id: str) -> bool:
        """`turn` is still live on `body_id`, so it owns the queue."""
        ...

    def pause(self) -> None:
        """Hold the queue at the sentence break (an interjection borrows it)."""
        ...

    def resume(self, tell: bool = True) -> None: ...

    def replace(self, turn: str, body_id: str, text: str) -> str | None:
        """Drop the turn's unsaid sentences and say `text` as a turn of its own (its id), or
        None when the turn is gone."""
        ...

    async def sample(self, text: str, voice: str | None, speed: float | None) -> bytes: ...
