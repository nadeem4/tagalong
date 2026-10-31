"""The seam between the brain and its voice models.

The server routes `listen`, `mic`, `unlisten` and `hush` here; the session reports spoken turns
(`spoken`, `reply`, `turn_ended`); Home asks for a `sample`. Neither knows about models.
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

    async def sample(self, text: str, voice: str | None, speed: float | None) -> bytes: ...
