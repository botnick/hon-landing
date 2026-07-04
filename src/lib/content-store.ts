/**
 * Content read/write against D1 (history) + KV (live). The single funnel every publish
 * and rollback goes through. All writes validate against the contract first.
 */
import type { D1Database } from './db';
import { validateSnapshot, migrateSnapshot, type ContentSnapshot, SCHEMA_VERSION } from './content-contract';

interface KV {
  get(key: string, type: 'json'): Promise<unknown>;
  get(key: string, type?: 'text'): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

/** A saved draft: the working snapshot plus who saved it and when (for the "แก้ล่าสุดโดย" note). */
export interface DraftEnvelope {
  snapshot: ContentSnapshot;
  savedBy: string;
  savedAt: number;
}

export interface VersionRow {
  version: number;
  snapshot: string;
  schema_version: number;
  note: string;
  author_email: string;
  created_at: number;
}

/**
 * Read the current live snapshot from KV — via a SINGLE key `site:live` that holds the
 * full snapshot (codex fix: KV is eventually consistent, so a two-key pointer→snapshot read
 * can momentarily expose a new pointer against a missing/stale snapshot at some edges).
 * One self-contained key is atomically consistent per read. Falls back to the legacy
 * two-key path for snapshots published before this change. Returns null if none/invalid.
 */
export async function readLive(kv: KV | undefined): Promise<ContentSnapshot | null> {
  if (!kv) return null;
  // Preferred: one atomic key. Backfill blocks added after it was stored (migrate),
  // so an older-shape valid snapshot renders fully instead of degrading to fallback.
  const live = (await kv.get('site:live', 'json')) as unknown;
  if (live) {
    const migrated = migrateSnapshot(live);
    if (validateSnapshot(migrated).ok) return migrated as ContentSnapshot;
  }
  // Legacy fallback: active_version pointer → versioned key.
  const active = await kv.get('active_version', 'text');
  if (!active) return null;
  const snap = (await kv.get(`site:v${active}`, 'json')) as unknown;
  if (!snap) return null;
  const migrated = migrateSnapshot(snap);
  return validateSnapshot(migrated).ok ? (migrated as ContentSnapshot) : null;
}

/**
 * DRAFT store (grok UX2): a single shared working copy in KV `site:draft` that is NOT live.
 * "บันทึกร่าง" writes here; the editor loads it if present; publishing clears it. Validated
 * on both write and read so a bad draft can never corrupt the editor.
 */
export async function writeDraft(kv: KV | undefined, snapshot: unknown, savedBy: string): Promise<{ ok: boolean; errors?: string[] }> {
  const migrated = migrateSnapshot(snapshot);
  const v = validateSnapshot(migrated);
  if (!v.ok) return { ok: false, errors: v.errors };
  if (!kv) return { ok: false, errors: ['ระบบยังไม่พร้อม (ไม่มีที่เก็บข้อมูล)'] };
  const env: DraftEnvelope = { snapshot: migrated as ContentSnapshot, savedBy, savedAt: Date.now() };
  await kv.put('site:draft', JSON.stringify(env));
  return { ok: true };
}

export async function readDraft(kv: KV | undefined): Promise<DraftEnvelope | null> {
  if (!kv) return null;
  const raw = (await kv.get('site:draft', 'json')) as DraftEnvelope | null;
  if (!raw || !raw.snapshot) return null;
  const migrated = migrateSnapshot(raw.snapshot);
  if (!validateSnapshot(migrated).ok) return null;
  return { snapshot: migrated as ContentSnapshot, savedBy: raw.savedBy, savedAt: raw.savedAt };
}

export async function clearDraft(kv: KV | undefined): Promise<void> {
  if (kv) await kv.delete('site:draft');
}

/** Read a specific version's snapshot from D1 (for the version view / rollback source),
 *  migrated to the current shape so a rollback republishes a complete snapshot. */
export async function readVersion(db: D1Database, version: number): Promise<ContentSnapshot | null> {
  const row = await db.prepare('SELECT snapshot FROM content_versions WHERE version = ?').bind(version).first<{ snapshot: string }>();
  if (!row) return null;
  try {
    return migrateSnapshot(JSON.parse(row.snapshot)) as ContentSnapshot;
  } catch {
    return null;
  }
}

/** List versions (newest first) for the history view. */
export async function listVersions(db: D1Database, limit = 50): Promise<VersionRow[]> {
  const r = await db.prepare('SELECT version, schema_version, note, author_email, created_at FROM content_versions ORDER BY version DESC LIMIT ?').bind(limit).all<VersionRow>();
  return r.results;
}

export async function currentLiveVersion(db: D1Database): Promise<number | null> {
  const lp = await db.prepare('SELECT version FROM live_pointer WHERE id=1').first<{ version: number }>();
  return lp?.version ?? null;
}

export interface PublishResult {
  ok: boolean;
  version?: number;
  errors?: string[];
}

/**
 * Validate → append a new version to D1 → write it to KV → flip active_version LAST
 * (so a reader never sees a pointer to a half-written snapshot) → purge edge cache.
 */
export async function publish(
  db: D1Database,
  kv: KV | undefined,
  snapshot: unknown,
  meta: { note: string; authorId?: string; authorEmail: string; baseVersion?: number | null },
  purge?: { zoneId?: string; apiToken?: string },
): Promise<PublishResult> {
  const v = validateSnapshot(snapshot);
  if (!v.ok) return { ok: false, errors: v.errors };

  // Optimistic concurrency (codex fix): if the client sends the version it edited from,
  // reject when the live version has moved on — so a stale tab can't silently clobber a
  // newer publish. baseVersion omitted/null ⇒ skip the check (e.g. first publish / seed).
  if (meta.baseVersion != null) {
    const live = await currentLiveVersion(db);
    if (live != null && live !== meta.baseVersion) {
      return { ok: false, errors: [`content changed (now v${live}, you edited v${meta.baseVersion}) — reload and re-apply`] };
    }
  }

  const snap = snapshot as ContentSnapshot;
  const json = JSON.stringify(snap);
  const now = Date.now();

  // 1. Append to D1 history.
  const ins = await db
    .prepare('INSERT INTO content_versions (snapshot, schema_version, note, author_id, author_email, created_at) VALUES (?,?,?,?,?,?)')
    .bind(json, SCHEMA_VERSION, meta.note.slice(0, 500), meta.authorId ?? null, meta.authorEmail, now)
    .run();
  const version = Number((ins.meta as any)?.last_row_id);
  if (!version || Number.isNaN(version)) return { ok: false, errors: ['failed to write version'] };

  // 2. Write the versioned copy (history) THEN the atomic live key LAST. A reader hitting
  //    `site:live` always sees a complete self-consistent snapshot — never a dangling pointer.
  if (kv) {
    await kv.put(`site:v${version}`, json);
    // live envelope carries the version for cache-busting / debugging.
    await kv.put('site:live', JSON.stringify(snap));
    await kv.put('active_version', String(version)); // kept for legacy readers
  }

  // 3. Flip the D1 live pointer.
  await db
    .prepare('INSERT INTO live_pointer (id, version, published_at, published_by) VALUES (1,?,?,?) ON CONFLICT(id) DO UPDATE SET version=?, published_at=?, published_by=?')
    .bind(version, now, meta.authorEmail, version, now, meta.authorEmail)
    .run();

  // 4. Best-effort edge cache purge (only if configured).
  if (purge?.zoneId && purge?.apiToken) {
    try {
      await fetch(`https://api.cloudflare.com/client/v4/zones/${purge.zoneId}/purge_cache`, {
        method: 'POST',
        headers: { authorization: `Bearer ${purge.apiToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ purge_everything: true }),
      });
    } catch {
      /* purge failure must not fail the publish */
    }
  }

  return { ok: true, version };
}

/** Roll back to an existing version by re-publishing its snapshot as a new version. */
export async function rollback(
  db: D1Database,
  kv: KV | undefined,
  toVersion: number,
  meta: { authorId?: string; authorEmail: string },
): Promise<PublishResult> {
  const snap = await readVersion(db, toVersion);
  if (!snap) return { ok: false, errors: [`version ${toVersion} not found`] };
  return publish(db, kv, snap, { note: `Rollback to v${toVersion}`, authorId: meta.authorId, authorEmail: meta.authorEmail });
}
