
    CREATE TABLE permissions(
        tool TEXT PRIMARY KEY,
        mode TEXT NOT NULL CHECK(mode IN ('ask','auto'))
    );
    