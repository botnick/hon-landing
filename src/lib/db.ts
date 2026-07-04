/**
 * Thin typed accessor over the D1 binding (CMS_DB). Every query is parameterised —
 * no string interpolation into SQL, ever.
 */

export interface D1Result<T = unknown> {
  results: T[];
  success: boolean;
  meta: unknown;
}
export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(col?: string): Promise<T | null>;
  run<T = unknown>(): Promise<D1Result<T>>;
  all<T = unknown>(): Promise<D1Result<T>>;
}
export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

export interface UserRow {
  id: string;
  email: string;
  name: string;
  role: 'owner' | 'editor' | 'viewer';
  pass_hash: string;
  disabled: number;
  created_at: number;
  updated_at: number;
  last_login: number | null;
}

export interface SessionRow {
  id: string;
  user_id: string;
  created_at: number;
  expires_at: number;
  ip: string;
  ua: string;
}

/** Look up a user by (lowercased) email. */
export function getUserByEmail(db: D1Database, email: string): Promise<UserRow | null> {
  return db.prepare('SELECT * FROM users WHERE email = ?').bind(email.toLowerCase()).first<UserRow>();
}

export function getUserById(db: D1Database, id: string): Promise<UserRow | null> {
  return db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>();
}

export async function listUsers(db: D1Database): Promise<UserRow[]> {
  const r = await db.prepare('SELECT * FROM users ORDER BY created_at ASC').all<UserRow>();
  return r.results;
}

/** Append an audit-log entry. Never throws into the caller's happy path. */
export async function audit(
  db: D1Database,
  entry: { actorId?: string | null; actorEmail?: string; action: string; target?: string; detail?: string; ip?: string },
): Promise<void> {
  try {
    await db
      .prepare(
        'INSERT INTO audit_log (at, actor_id, actor_email, action, target, detail, ip) VALUES (?,?,?,?,?,?,?)',
      )
      .bind(
        Date.now(),
        entry.actorId ?? null,
        entry.actorEmail ?? '',
        entry.action,
        entry.target ?? '',
        entry.detail ?? '',
        entry.ip ?? '',
      )
      .run();
  } catch {
    /* audit must never break the request */
  }
}
