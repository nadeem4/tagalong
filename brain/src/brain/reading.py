"""The reading status each body last reported: how Scout reads the screen on that PC.

Kept in memory only (the body resends on connect). Single user, so the most recently
reported body is the one Home shows; a body that goes away takes its copy with it.
"""

from brain.protocol import ReadingData, ReadingRow


class ReadingStore:
    def __init__(self) -> None:
        self._by_body: dict[str, ReadingData] = {}  # insertion order = last reported last

    def set(self, body_id: str, data: ReadingData) -> bool:
        """Keep the copy; say whether it differs from what was kept."""
        changed = self._by_body.get(body_id) != data
        self._by_body.pop(body_id, None)  # re-insert so it counts as the most recent
        self._by_body[body_id] = data
        return changed

    def forget(self, body_id: str) -> bool:
        return self._by_body.pop(body_id, None) is not None

    def rows(self) -> list[dict]:
        if not self._by_body:
            return []
        latest = next(reversed(self._by_body.values()))
        return [r.model_dump(exclude_none=True) for r in latest.rows]

    def ocr_problem(self) -> ReadingRow | None:
        if not self._by_body:
            return None
        latest = next(reversed(self._by_body.values()))
        return next(
            (
                r
                for r in latest.rows
                if r.capability == "text-from-pictures" and r.state != "working"
            ),
            None,
        )
