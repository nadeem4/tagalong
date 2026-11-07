
    CREATE TABLE tool_outputs(
        id TEXT PRIMARY KEY,
        tool TEXT NOT NULL,
        chars INTEGER NOT NULL,
        text TEXT NOT NULL,
        at TEXT NOT NULL
    );
    