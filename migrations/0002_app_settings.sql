-- App-level, NON-SECRET settings (key/value). Secrets (API keys) live in env, never here.
-- Used by the AI translation config: provider / base URL / model. The provider API key
-- is the env secret TRANSLATE_API_KEY and is never stored in D1.
CREATE TABLE IF NOT EXISTS app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT 0
);
