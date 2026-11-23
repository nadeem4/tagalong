-- A memory write must say who wrote it, and a client of the memory endpoint may be allowed the
-- personal facts. `source` has existed since 0033; this makes a blank one impossible.
CREATE TRIGGER memories_source_insert BEFORE INSERT ON memories
WHEN trim(NEW.source) = ''
BEGIN SELECT RAISE(ABORT, 'a memory needs a source'); END;
CREATE TRIGGER memories_source_update BEFORE UPDATE OF source ON memories
WHEN trim(NEW.source) = ''
BEGIN SELECT RAISE(ABORT, 'a memory needs a source'); END;
ALTER TABLE devices ADD COLUMN personal INTEGER NOT NULL DEFAULT 0;
