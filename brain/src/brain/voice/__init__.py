"""The seam between the brain and its voice models.

The server routes `listen`, `mic`, `unlisten` and `hush` here; the session reports spoken turns
(`spoken`, `reply`, `turn_ended`), asks for a turn's `sentences` and, for an interjection, takes
the queue (`queued`, `pause`, `replace`, `resume`);
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

    def queued(self, body_id: str) -> tuple[str | None, list[str]]:
        """The turn that owns `body_id`'s speech queue and the sentences it has not said."""
        ...

    def pause(self) -> None:
        """Hold the queue at the sentence break (an interjection borrows it)."""
        ...

    def resume(self) -> None: ...

    def replace(self, turn: str, body_id: str, text: str) -> None:
        """Drop the turn's unsaid sentences and say `text` in their place."""
        ...

    async def sample(self, text: str, voice: str | None, speed: float | None) -> bytes: ...
