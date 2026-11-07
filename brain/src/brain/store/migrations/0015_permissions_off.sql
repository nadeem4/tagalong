
    CREATE TABLE permissions_new(
        tool TEXT PRIMARY KEY,
        mode TEXT NOT NULL CHECK(mode IN ('off','ask','auto'))
    );
    INSERT INTO permissions_new(tool, mode) SELECT tool, mode FROM permissions;
    DROP TABLE permissions;
    ALTER TABLE permissions_new RENAME TO permissions;
    