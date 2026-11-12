"""The plug-in shape of a get-to-know-me source: it only reads, and says plainly when it can't.

A new source is one module with these three attributes and a `read`, plus one line in the
default list. `SourceGap` carries the plain line shown under the portrait.
"""

from typing import Literal, Protocol

from brain.know.facts import Known, Material


class SourceGap(Exception):
    """The source could not give anything; str(e) is the line the person sees."""


class KnowSource(Protocol):
    name: str
    needs: Literal["username", "file", "none"]
    label: str

    async def read(self, given: str | bytes | None, known: Known) -> list[Material]:
        """Raise SourceGap when nothing could be read. Never writes anywhere."""
        ...
