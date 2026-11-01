"""The one network call the registry read makes: GET a URL and return its bytes.

A seam (`GetJson`) so tests never touch the network. Standard library only, run off the loop.
"""

import asyncio
import urllib.request
from collections.abc import Awaitable, Callable

GetJson = Callable[[str], Awaitable[bytes]]
TIMEOUT_S = 15


def _get(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "tagalong"})
    with urllib.request.urlopen(request, timeout=TIMEOUT_S) as response:
        return response.read()


async def real_get_json(url: str) -> bytes:
    return await asyncio.to_thread(_get, url)
