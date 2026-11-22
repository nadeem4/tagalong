-- Paired devices (their tokens kept only as hashes), one-time pairing codes, and the failed
-- attempts the rate limit counts.
CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('desktop','browser','node','mcp_client')),
  token_hash TEXT NOT NULL UNIQUE,
  paired_at TEXT NOT NULL,
  last_seen TEXT,
  revoked_at TEXT
);
CREATE TABLE pair_codes (
  id TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE TABLE pair_failures (at TEXT NOT NULL);
CREATE INDEX pair_failures_at ON pair_failures(at);
