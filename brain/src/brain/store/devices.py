"""SQL for paired devices and one-time pairing codes. Only hashes of tokens and codes are kept."""

import sqlite3

_DEVICE_COLUMNS = "id, name, kind, personal, paired_at, last_seen, revoked_at"


def insert_device(
    db: sqlite3.Connection,
    *,
    id: str,
    name: str,
    kind: str,
    token_hash: str,
    now: str,
    personal: bool = False,
) -> None:
    db.execute(
        "INSERT INTO devices(id, name, kind, token_hash, paired_at, personal)"
        " VALUES (?, ?, ?, ?, ?, ?)",
        (id, name, kind, token_hash, now, personal),
    )


def device_by_token_hash(
    db: sqlite3.Connection, token_hash: str
) -> tuple[str, str, str, bool] | None:
    """(id, name, kind, personal) of the live device holding this token."""
    row = db.execute(
        "SELECT id, name, kind, personal FROM devices WHERE token_hash=? AND revoked_at IS NULL",
        (token_hash,),
    ).fetchone()
    return None if row is None else (row[0], row[1], row[2], bool(row[3]))


def list_devices(db: sqlite3.Connection) -> list[dict]:
    cursor = db.execute(f"SELECT {_DEVICE_COLUMNS} FROM devices ORDER BY paired_at, id")
    names = [column[0] for column in cursor.description]
    return [dict(zip(names, row, strict=True)) for row in cursor]


def rename_device(db: sqlite3.Connection, id: str, name: str) -> bool:
    return db.execute("UPDATE devices SET name=? WHERE id=?", (name, id)).rowcount > 0


def revoke_device(db: sqlite3.Connection, id: str, now: str) -> bool:
    return (
        db.execute(
            "UPDATE devices SET revoked_at=? WHERE id=? AND revoked_at IS NULL", (now, id)
        ).rowcount
        > 0
    )


def touch_device(db: sqlite3.Connection, id: str, now: str) -> None:
    db.execute("UPDATE devices SET last_seen=? WHERE id=?", (now, id))


def insert_pair_code(
    db: sqlite3.Connection,
    *,
    id: str,
    secret_hash: str,
    kind: str,
    expires_at: str,
    personal: bool = False,
    name: str = "",
) -> None:
    db.execute(
        "INSERT INTO pair_codes(id, secret_hash, kind, expires_at, personal, name)"
        " VALUES (?, ?, ?, ?, ?, ?)",
        (id, secret_hash, kind, expires_at, personal, name),
    )


def redeem_pair_code(
    db: sqlite3.Connection, secret_hash: str, kind: str, now: str
) -> tuple[bool, str] | None:
    """Spend the code in the same statement that finds it, so two redeems cannot both win.
    Returns the code's (`personal`, `name`), or None when it is unknown, used, expired or of
    another kind."""
    row = db.execute(
        "UPDATE pair_codes SET used_at=? WHERE secret_hash=? AND kind=? AND used_at IS NULL"
        " AND expires_at>? RETURNING personal, name",
        (now, secret_hash, kind, now),
    ).fetchone()
    return None if row is None else (bool(row[0]), row[1])


def delete_expired_codes(db: sqlite3.Connection, now: str) -> None:
    db.execute("DELETE FROM pair_codes WHERE expires_at<=?", (now,))


def record_failure(db: sqlite3.Connection, now: str) -> None:
    db.execute("INSERT INTO pair_failures(at) VALUES (?)", (now,))


def delete_old_failures(db: sqlite3.Connection, since: str) -> None:
    db.execute("DELETE FROM pair_failures WHERE at<?", (since,))


def count_recent_failures(db: sqlite3.Connection, since: str) -> int:
    return db.execute("SELECT COUNT(*) FROM pair_failures WHERE at>=?", (since,)).fetchone()[0]
