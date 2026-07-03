-- Content version history for the admin publish endpoint (/api/publish).
-- Each publish inserts a full JSON snapshot; KV holds the live pointer.
CREATE TABLE IF NOT EXISTS site_versions (
  version    INTEGER PRIMARY KEY,
  json       TEXT    NOT NULL,
  created_at TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_site_versions_created_at
  ON site_versions (created_at);
