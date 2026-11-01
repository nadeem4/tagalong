"""The real network calls setup makes: GET a URL as bytes (`real_get_json`) or as a stream.

Seams (`GetJson`, and `Fetch` from voice/models.py) so tests never touch the network. Standard
library only, run off the loop.
"""

import asyncio
import urllib.request
from collections.abc import AsyncIterator, Awaitable, Callable

GetJson = Callable[[str], Awaitable[bytes]]
TIMEOUT_S = 15


def _get(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "tagalong"})
    with urllib.request.urlopen(request, timeout=TIMEOUT_S) as response:
        return response.read()


async def real_get_json(url: str) -> bytes:
    return await asyncio.to_thread(_get, url)


CHUNK = 1 << 20


async def http_fetch(url: str) -> AsyncIterator[bytes]:
    """Stream a download in chunks. The timeout covers each read, so a stall ends as an OSError."""
    request = urllib.request.Request(url, headers={"User-Agent": "tagalong"})
    response = await asyncio.to_thread(urllib.request.urlopen, request, timeout=TIMEOUT_S)
    try:
        if response.status != 200:
            raise OSError(f"{url}: HTTP {response.status}")
        while chunk := await asyncio.to_thread(response.read, CHUNK):
            yield chunk
    finally:
        response.close()
