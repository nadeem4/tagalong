"""The seam between the websocket server and the brain's voice models.

The server routes `listen`, `mic`, `unlisten` and `hush` here and knows nothing about
models; the real service arrives in a later slice. Every method must tolerate a body
that never listened, because the server calls `unlisten` on every disconnect.
"""

from typing import Literal, Protocol


class VoiceHooks(Protocol):
    def listen(self, body_id: str, mode: Literal["held", "always"]) -> None: ...

    def mic(self, body_id: str, pcm: bytes) -> None: ...

    def unlisten(self, body_id: str) -> None: ...

    def hush(self, body_id: str) -> None: ...
