
    CREATE TABLE apps(
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        transport TEXT NOT NULL CHECK(transport IN ('stdio','http')),
        config TEXT NOT NULL,
        auth TEXT NOT NULL CHECK(auth IN ('none','token','oauth')),
        enabled INTEGER NOT NULL DEFAULT 1
    );
    