"""Long tool results kept for `read_output`: the `tool_outputs` table."""

import sqlite3


def put_output(db: sqlite3.Connection, output_id: str, tool: str, text: str, at: str) -> None:
    db.execute(
        "INSERT INTO tool_outputs(id, tool, chars, text, at) VALUES (?, ?, ?, ?, ?)",
        (output_id, tool, len(text), text, at),
    )


def get_output(db: sqlite3.Connection, output_id: str) -> str | None:
    row = db.execute("SELECT text FROM tool_outputs WHERE id=?", (output_id,)).fetchone()
    return None if row is None else row[0]


def prune_outputs(db: sqlite3.Connection, keep: int) -> None:
    """Keep the newest `keep` stored outputs (rowid order is insertion order)."""
    db.execute(
        "DELETE FROM tool_outputs WHERE rowid NOT IN "
        "(SELECT rowid FROM tool_outputs ORDER BY rowid DESC LIMIT ?)",
        (keep,),
    )
