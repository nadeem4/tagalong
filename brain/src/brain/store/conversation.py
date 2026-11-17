"""The saved chat: the `messages` table and its searchable text.

Image and document blocks are stored as text markers, so the file never holds screenshots.
"""

import json
import sqlite3

from brain.protocol import BODY_DESKTOP

_MARKERS = {"image": "[screenshot]", "document": "[document]"}


def compaction_text(block: dict) -> str:
    """The summary text of a compaction block; empty when compaction failed (content null)."""
    return block.get("content") or ""


def _clean_block(block, texts: list[str]):
    """Replace image/document blocks with text markers; collect searchable text.

    Thinking and tool_use input are kept in content_json (the API needs them to resume) but
    never reach the searchable text.
    """
    if not isinstance(block, dict):
        return block
    kind = block.get("type")
    if kind in _MARKERS:
        texts.append(_MARKERS[kind])
        return {"type": "text", "text": _MARKERS[kind]}
    if kind == "text":
        texts.append(block.get("text", ""))
    elif kind == "tool_result":
        inner = block.get("content")
        if isinstance(inner, str):
            texts.append(inner)
        elif isinstance(inner, list):
            return {**block, "content": [_clean_block(b, texts) for b in inner]}
    return block


def _encode_message(m: dict) -> tuple[str, str]:
    """The stored JSON of a message and its searchable text."""
    texts: list[str] = []
    content = m["content"]
    if not isinstance(content, str):
        content = [_clean_block(b, texts) for b in content]
    else:
        texts.append(content)
    return json.dumps(content), "\n".join(t for t in texts if t)


def save_messages(
    db: sqlite3.Connection,
    msgs: list[dict],
    at: str,
    body: str = BODY_DESKTOP,
    *,
    event_ids: list[str | None] | None = None,
    sources: list[str | None] | None = None,
) -> list[int]:
    """Save `msgs` in one transaction; the new row ids in order. `event_ids` and `sources` run
    beside `msgs`: a user row made from a taken event names it and where it came from."""
    events = event_ids or [None] * len(msgs)
    froms = sources or [None] * len(msgs)
    ids: list[int] = []
    db.execute("BEGIN IMMEDIATE")
    try:
        for m, event_id, source in zip(msgs, events, froms, strict=True):
            content, text = _encode_message(m)
            cur = db.execute(
                "INSERT INTO messages(at, role, content_json, text, body, event_id, source)"
                " VALUES (?,?,?,?,?,?,?)",
                (at, m["role"], content, text, body, event_id, source),
            )
            ids.append(int(cur.lastrowid or 0))
    except BaseException:
        db.execute("ROLLBACK")
        raise
    db.execute("COMMIT")
    return ids


def replace_last_message(db: sqlite3.Connection, message: dict) -> None:
    """Rewrite the newest saved message: a spoken-over reply keeps only what was said."""
    content, text = _encode_message(message)
    db.execute(
        "UPDATE messages SET content_json=?, text=? WHERE id=(SELECT MAX(id) FROM messages)",
        (content, text),
    )


def set_cut(db: sqlite3.Connection, ids: list[int], cut: bool) -> None:
    """Mark (or unmark) the rows of a request cancelled before any reply."""
    db.executemany("UPDATE messages SET cut=? WHERE id=?", [(1 if cut else 0, i) for i in ids])


def load_messages(db: sqlite3.Connection, include_cut: bool = False) -> list[dict]:
    """The saved chat in order; cut requests are left out unless asked for."""
    where = "" if include_cut else "WHERE cut=0 "
    rows = db.execute(f"SELECT role, content_json FROM messages {where}ORDER BY id")
    return [{"role": r, "content": json.loads(c)} for r, c in rows]
