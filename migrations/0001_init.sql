-- HoN X CMS — initial schema (D1 / SQLite).
-- Real tables. RBAC + sessions + content version history + audit log.
-- Idempotent: safe to re-run (IF NOT EXISTS everywhere).

-- ─── Users & RBAC ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,                 -- random 16-byte hex
  email       TEXT NOT NULL UNIQUE,             -- lowercased login id
  name        TEXT NOT NULL DEFAULT '',
  role        TEXT NOT NULL CHECK (role IN ('owner','editor','viewer')),
  pass_hash   TEXT NOT NULL,                    -- pbkdf2$<iters>$<saltB64>$<hashB64>
  disabled    INTEGER NOT NULL DEFAULT 0,       -- 1 = cannot log in
  created_at  INTEGER NOT NULL,                 -- epoch ms
  updated_at  INTEGER NOT NULL,
  last_login  INTEGER                           -- epoch ms, nullable
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- ─── Sessions (server-side; cookie holds only the opaque id) ──────────────────
CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,                 -- random 32-byte hex (the cookie value)
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,                 -- epoch ms; enforced on every request
  ip          TEXT NOT NULL DEFAULT '',
  ua          TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- ─── Content version history (source of truth for rollback) ───────────────────
-- Each publish appends a row. KV holds the *live* pointer; D1 holds every version.
CREATE TABLE IF NOT EXISTS content_versions (
  version       INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot      TEXT NOT NULL,                  -- full JSON payload (the KV contract)
  schema_version INTEGER NOT NULL DEFAULT 1,    -- contract version, validated both sides
  note          TEXT NOT NULL DEFAULT '',       -- author's changelog line
  author_id     TEXT REFERENCES users(id),
  author_email  TEXT NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_versions_created ON content_versions(created_at);

-- Which version is currently live (mirrors KV active_version; single row id=1).
CREATE TABLE IF NOT EXISTS live_pointer (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  version       INTEGER NOT NULL REFERENCES content_versions(version),
  published_at  INTEGER NOT NULL,
  published_by  TEXT NOT NULL DEFAULT ''
);

-- ─── Audit log (append-only; who did what) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  at          INTEGER NOT NULL,
  actor_id    TEXT,
  actor_email TEXT NOT NULL DEFAULT '',
  action      TEXT NOT NULL,                    -- e.g. 'login','publish','user.create','rollback'
  target      TEXT NOT NULL DEFAULT '',         -- affected entity id/label
  detail      TEXT NOT NULL DEFAULT '',         -- short human note (no secrets)
  ip          TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at);

-- ─── Login rate-limit (per identifier; also enforced in KV for speed) ─────────
CREATE TABLE IF NOT EXISTS login_attempts (
  id          TEXT PRIMARY KEY,                 -- email or ip
  count       INTEGER NOT NULL DEFAULT 0,
  first_at    INTEGER NOT NULL,
  locked_until INTEGER NOT NULL DEFAULT 0
);
