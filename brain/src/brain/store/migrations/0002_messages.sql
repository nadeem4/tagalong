
    CREATE TABLE messages(
        id INTEGER PRIMARY KEY,
        at TEXT NOT NULL,
        role TEXT NOT NULL,
        content_json TEXT NOT NULL,
        text TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE messages_fts USING fts5(
        text, content='messages', content_rowid='id', tokenize='porter unicode61'
    );
    CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(rowid, text) VALUES (new.id, new.text);
    END;
    CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, text) VALUES ('delete', old.id, old.text);
    END;
    CREATE TRIGGER messages_au AFTER UPDATE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, text) VALUES ('delete', old.id, old.text);
        INSERT INTO messages_fts(rowid, text) VALUES (new.id, new.text);
    END;
    