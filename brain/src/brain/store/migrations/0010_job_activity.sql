
    CREATE TABLE job_activity(
        job_id TEXT NOT NULL,
        rev INTEGER NOT NULL,
        seq INTEGER NOT NULL,
        at TEXT NOT NULL,
        kind TEXT NOT NULL,
        step TEXT,
        status TEXT,
        exit INTEGER,
        text TEXT NOT NULL,
        PRIMARY KEY(job_id, seq)
    );
    CREATE INDEX job_activity_rev ON job_activity(job_id, rev);
    