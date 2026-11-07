
    CREATE TABLE memories(
        id INTEGER PRIMARY KEY,
        kind TEXT NOT NULL,
        text TEXT NOT NULL,
        cadence TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE memories_fts USING fts5(
        text, content='memories', content_rowid='id', tokenize='porter unicode61'
    );
    CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
        INSERT INTO memories_fts(rowid, text) VALUES (new.id, new.text);
    END;
    CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, text) VALUES ('delete', old.id, old.text);
    END;
    CREATE TRIGGER memories_au AFTER UPDATE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, text) VALUES ('delete', old.id, old.text);
        INSERT INTO memories_fts(rowid, text) VALUES (new.id, new.text);
    END;
    