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
    """Keep the newest `keep` stored outputs that no work row names (rowid order is insertion
    order). A named one is a job's long report, its record, so it is never counted or cut."""
    linked = "SELECT detail_id FROM work WHERE detail_id IS NOT NULL"
    db.execute(
        f"DELETE FROM tool_outputs WHERE id NOT IN ({linked}) AND rowid NOT IN "
        f"(SELECT rowid FROM tool_outputs WHERE id NOT IN ({linked}) "
        "ORDER BY rowid DESC LIMIT ?)",
        (keep,),
    )
