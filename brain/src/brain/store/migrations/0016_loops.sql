
    CREATE TABLE loops(
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        ref TEXT NOT NULL,
        title TEXT NOT NULL,
        asks TEXT NOT NULL,
        direction TEXT NOT NULL,
        people TEXT NOT NULL,
        due TEXT,
        quiet_after TEXT,
        anchors TEXT NOT NULL,
        status TEXT NOT NULL,
        history TEXT NOT NULL,
        created TEXT NOT NULL,
        updated TEXT NOT NULL,
        UNIQUE(source, ref)
    );
    CREATE TABLE loop_surfaced(
        loop_id TEXT NOT NULL,
        anchor TEXT NOT NULL,
        day TEXT NOT NULL,
        PRIMARY KEY(loop_id, anchor)
    );
    CREATE TABLE loop_cursor(
        app_id TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
    