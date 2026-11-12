"""The real network calls setup makes: GET a URL as bytes (`real_get_json`) or as a stream.

Seams (`GetJson`, and `Fetch` from voice/models.py) so tests never touch the network. Standard
library only, run off the loop. A download is a `ByteStream`: the chunks, plus `size` (the
Content-Length, once known) so a reader can show a percent. `percent_steps` throttles it.
"""

import asyncio
import urllib.request
from collections.abc import AsyncIterator, Awaitable, Callable

GetJson = Callable[[str], Awaitable[bytes]]
TIMEOUT_S = 15
PERCENT_STEP = 5  # a download reports at most one update per this many percent


class ByteStream:
    """An async iterator of chunks that also carries `size`: None until known, and None when the
    server did not say. Read `size` after the first chunk."""

    def __init__(
        self, read: Callable[["ByteStream"], AsyncIterator[bytes]], size: int | None = None
    ) -> None:
        self.size = size
        self._chunks = read(self)

    def __aiter__(self) -> "ByteStream":
        return self

    async def __anext__(self) -> bytes:
        return await self._chunks.__anext__()


def percent_steps(total: int | None, emit: Callable[[int], None]) -> Callable[[int], None]:
    """A running byte count in, whole percents out, one per PERCENT_STEP and a last one at 100.
    With no known total nothing is emitted: the caller's stage already says what is happening."""
    last = -PERCENT_STEP
    if not total:
        return lambda received: None

    def report(received: int) -> None:
        nonlocal last
        percent = min(100, received * 100 // total)
        if percent >= last + PERCENT_STEP or (percent == 100 and last != 100):
            last = percent
            emit(percent)

    return report


def _get(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "tagalong"})
    with urllib.request.urlopen(request, timeout=TIMEOUT_S) as response:
        return response.read()


async def real_get_json(url: str) -> bytes:
    return await asyncio.to_thread(_get, url)


CHUNK = 1 << 20


def http_fetch(url: str) -> ByteStream:
    """Stream a download in chunks. The timeout covers each read, so a stall ends as an OSError."""
    return ByteStream(lambda stream: _read(url, stream))


async def _read(url: str, stream: ByteStream) -> AsyncIterator[bytes]:
    request = urllib.request.Request(url, headers={"User-Agent": "tagalong"})
    response = await asyncio.to_thread(urllib.request.urlopen, request, timeout=TIMEOUT_S)
    try:
        if not response.url.startswith("https://"):  # a redirect must not downgrade
            raise OSError(f"{url}: redirected to a non-https address")
        if response.status != 200:
            raise OSError(f"{url}: HTTP {response.status}")
        length = response.headers.get("Content-Length", "")
        stream.size = int(length) if length.isdigit() else None
        while chunk := await asyncio.to_thread(response.read, CHUNK):
            yield chunk
    finally:
        response.close()
