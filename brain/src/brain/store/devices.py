"""SQL for paired devices and one-time pairing codes. Only hashes of tokens and codes are kept."""

import sqlite3

DEVICE_COLUMNS = "id, name, kind, paired_at, last_seen, revoked_at"


def insert_device(
    db: sqlite3.Connection, *, id: str, name: str, kind: str, token_hash: str, now: str
) -> None:
    db.execute(
        "INSERT INTO devices(id, name, kind, token_hash, paired_at) VALUES (?, ?, ?, ?, ?)",
        (id, name, kind, token_hash, now),
    )


def device_by_token_hash(db: sqlite3.Connection, token_hash: str) -> tuple[str, str, str] | None:
    """(id, name, kind) of the live device holding this token."""
    return db.execute(
        "SELECT id, name, kind FROM devices WHERE token_hash=? AND revoked_at IS NULL",
        (token_hash,),
    ).fetchone()


def list_devices(db: sqlite3.Connection) -> list[tuple]:
    return db.execute(f"SELECT {DEVICE_COLUMNS} FROM devices ORDER BY paired_at, id").fetchall()


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
    db: sqlite3.Connection, *, id: str, secret_hash: str, kind: str, expires_at: str
) -> None:
    db.execute(
        "INSERT INTO pair_codes(id, secret_hash, kind, expires_at) VALUES (?, ?, ?, ?)",
        (id, secret_hash, kind, expires_at),
    )


def redeem_pair_code(db: sqlite3.Connection, secret_hash: str, now: str) -> tuple[str, str] | None:
    """(id, kind) of the code, spent in the same statement that finds it."""
    return db.execute(
        "UPDATE pair_codes SET used_at=? WHERE secret_hash=? AND used_at IS NULL"
        " AND expires_at>? RETURNING id, kind",
        (now, secret_hash, now),
    ).fetchone()


def record_failure(db: sqlite3.Connection, now: str) -> None:
    db.execute("INSERT INTO pair_failures(at) VALUES (?)", (now,))


def count_recent_failures(db: sqlite3.Connection, since: str) -> int:
    return db.execute("SELECT COUNT(*) FROM pair_failures WHERE at>=?", (since,)).fetchone()[0]
