
    CREATE TABLE jobs(
        id TEXT PRIMARY KEY,
        agent TEXT, task TEXT, folder TEXT, mode TEXT,
        state TEXT, reason TEXT, progress TEXT, result TEXT, session_id TEXT,
        reported INTEGER DEFAULT 0,
        started_at TEXT, ended_at TEXT
    );
    