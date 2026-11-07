    CREATE TABLE work(
        id TEXT PRIMARY KEY,
        parent_id TEXT,
        root_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        kind TEXT NOT NULL,
        state TEXT NOT NULL,
        title TEXT NOT NULL,
        input TEXT,
        summary TEXT,
        detail_id TEXT,
        progress TEXT,
        checkpoint TEXT,
        attempt INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        safe_to_retry INTEGER NOT NULL DEFAULT 0,
        error_kind TEXT,
        last_error TEXT,
        due_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        ended_at TEXT,
        end_reason TEXT,
        reported_at TEXT,
        source_message_id INTEGER
    );
    CREATE INDEX work_state_due ON work(state, due_at);
    CREATE INDEX work_root_seq ON work(root_id, seq);
    CREATE INDEX work_parent_seq ON work(parent_id, seq);
    CREATE INDEX work_kind_state ON work(kind, state);
    CREATE INDEX work_unreported ON work(reported_at)
        WHERE state IN ('done','failed','cancelled','expired');
    CREATE TABLE work_events(
        id INTEGER PRIMARY KEY,
        work_id TEXT NOT NULL,
        at TEXT NOT NULL,
        kind TEXT NOT NULL,
        data TEXT
    );
    CREATE INDEX work_events_work ON work_events(work_id, id);
    CREATE VIRTUAL TABLE work_fts USING fts5(
        title, summary, content='work', content_rowid='rowid', tokenize='porter unicode61'
    );
    CREATE TRIGGER work_ai AFTER INSERT ON work BEGIN
        INSERT INTO work_fts(rowid, title, summary) VALUES (new.rowid, new.title, new.summary);
    END;
    CREATE TRIGGER work_ad AFTER DELETE ON work BEGIN
        INSERT INTO work_fts(work_fts, rowid, title, summary)
            VALUES ('delete', old.rowid, old.title, old.summary);
    END;
    CREATE TRIGGER work_au AFTER UPDATE ON work BEGIN
        INSERT INTO work_fts(work_fts, rowid, title, summary)
            VALUES ('delete', old.rowid, old.title, old.summary);
        INSERT INTO work_fts(rowid, title, summary) VALUES (new.rowid, new.title, new.summary);
    END;
