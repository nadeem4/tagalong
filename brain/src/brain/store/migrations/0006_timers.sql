
    CREATE TABLE timers(
        id INTEGER PRIMARY KEY,
        note TEXT NOT NULL,
        next_at TEXT NOT NULL,
        repeat_s INTEGER,
        created_at TEXT NOT NULL,
        fired INTEGER NOT NULL DEFAULT 0
    );
    