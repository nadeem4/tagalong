
    CREATE TABLE approvals(
        id INTEGER PRIMARY KEY,
        source TEXT NOT NULL CHECK(source IN ('scout_tool','claude_code','app')),
        tool TEXT NOT NULL,
        summary TEXT NOT NULL,
        input TEXT NOT NULL,
        job_id TEXT,
        group_key TEXT NOT NULL,
        outcome TEXT NOT NULL CHECK(outcome IN ('approved','refused','timed_out','no_one')),
        decided_by TEXT NOT NULL CHECK(decided_by IN ('person','scout','none')),
        preference_id INTEGER,
        at TEXT NOT NULL
    );
    CREATE TABLE preferences(
        id INTEGER PRIMARY KEY,
        sentence TEXT NOT NULL,
        source TEXT,
        tool TEXT,
        group_key TEXT,
        builtin INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        use_count INTEGER NOT NULL DEFAULT 0,
        last_used TEXT
    );
    CREATE TABLE offers(
        id INTEGER PRIMARY KEY,
        group_key TEXT NOT NULL,
        at TEXT NOT NULL,
        outcome TEXT NOT NULL CHECK(outcome IN ('yes','keep_asking','no_answer','none'))
    );
    INSERT INTO preferences(sentence, builtin, created_at)
        VALUES ('Always ask me before risky actions', 1, strftime('%Y-%m-%dT%H:%M:%S+00:00','now'));
    