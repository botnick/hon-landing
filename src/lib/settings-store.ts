/**
 * Non-secret app settings (D1 app_settings) + the translation provider API key.
 *
 * Split by sensitivity (codex hygiene):
 *  - provider / baseUrl / model  → D1 app_settings (non-secret, safe to return to the client).
 *  - API key                     → KV key `translate:key` OR the env secret TRANSLATE_API_KEY.
 *    The key is WRITE-ONLY from the UI (you can set/replace it, never read it back to the
 *    browser) — the settings endpoint only reports whether one is present.
 */
import type { D1Database } from './db';
import type { TranslateProvider } from './translate';

interface KV {
  get(key: string, type?: 'text'): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

const TKEY = 'translate:key';

export interface TranslateSettings {
  provider?: TranslateProvider;
  baseUrl?: string;
  model?: string;
  apiKey?: string; // filled from KV/env server-side; NEVER sent to the client
}

async function getSetting(db: D1Database, key: string): Promise<string | null> {
  try {
    const row = await db.prepare('SELECT value FROM app_settings WHERE key = ?').bind(key).first<{ value: string }>();
    return row?.value ?? null;
  } catch {
    return null; // table not migrated yet
  }
}

async function setSetting(db: D1Database, key: string, value: string, at: number): Promise<void> {
  await db
    .prepare('INSERT INTO app_settings (key, value, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at')
    .bind(key, value, at)
    .run();
}

/** Read provider/baseUrl/model from D1 + the API key from KV (falling back to env at call site). */
export async function getTranslateSettings(db: D1Database, kv?: KV): Promise<TranslateSettings | null> {
  const provider = (await getSetting(db, 'translate_provider')) as TranslateProvider | null;
  const baseUrl = await getSetting(db, 'translate_base_url');
  const model = await getSetting(db, 'translate_model');
  let apiKey: string | undefined;
  if (kv) apiKey = (await kv.get(TKEY, 'text')) || undefined;
  if (!provider && !baseUrl && !model && !apiKey) return null;
  return {
    provider: provider || undefined,
    baseUrl: baseUrl || undefined,
    model: model || undefined,
    apiKey,
  };
}

/** For the settings page: the non-secret config + whether a key is configured (never the key). */
export async function getTranslateSettingsPublic(
  db: D1Database,
  kv: KV | undefined,
  env: Record<string, string | undefined> | undefined,
): Promise<{ provider: string; baseUrl: string; model: string; hasKey: boolean }> {
  const s = await getTranslateSettings(db, kv);
  const hasKey = !!(s?.apiKey || env?.TRANSLATE_API_KEY);
  return {
    provider: s?.provider || env?.TRANSLATE_PROVIDER || 'openrouter',
    baseUrl: s?.baseUrl || env?.TRANSLATE_BASE_URL || '',
    model: s?.model || env?.TRANSLATE_MODEL || '',
    hasKey,
  };
}

/** Save non-secret provider config. */
export async function saveTranslateSettings(
  db: D1Database,
  cfg: { provider?: string; baseUrl?: string; model?: string },
  at: number,
): Promise<void> {
  if (cfg.provider !== undefined) await setSetting(db, 'translate_provider', String(cfg.provider).slice(0, 40), at);
  if (cfg.baseUrl !== undefined) await setSetting(db, 'translate_base_url', String(cfg.baseUrl).slice(0, 400), at);
  if (cfg.model !== undefined) await setSetting(db, 'translate_model', String(cfg.model).slice(0, 120), at);
}

/** Store / clear the API key in KV (write-only; never returned to the browser). */
export async function saveTranslateKey(kv: KV | undefined, key: string): Promise<void> {
  if (!kv) return;
  const k = key.trim();
  if (k) await kv.put(TKEY, k);
  else await kv.delete(TKEY);
}
