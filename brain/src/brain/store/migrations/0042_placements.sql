-- Where each expert and app runs: the brain, one body's node, or both with a preference.
CREATE TABLE placements (
  target_kind TEXT NOT NULL CHECK (target_kind IN ('expert','app')),
  target_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('brain','body','both')),
  body_id TEXT,
  prefer TEXT CHECK (prefer IN ('body','brain','ask')),
  PRIMARY KEY (target_kind, target_id)
);
