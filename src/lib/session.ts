/**
 * Server-side sessions. The cookie holds ONLY an opaque random id; all state lives in D1.
 * Cookie is __Host- prefixed (implies Secure + Path=/ + no Domain) — the strongest binding.
 */
import type { D1Database, SessionRow, UserRow } from './db';
import { getUserById } from './db';
import { randomId } from './crypto';

export const COOKIE_NAME = '__Host-honx_sess';
const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12h

export interface AuthedUser {
  id: string;
  email: string;
  name: string;
  role: 'owner' | 'editor' | 'viewer';
}

/** Create a session row and return its id (the cookie value). */
export async function createSession(
  db: D1Database,
  userId: string,
  ip = '',
  ua = '',
): Promise<string> {
  const id = randomId(32);
  const now = Date.now();
  await db
    .prepare('INSERT INTO sessions (id, user_id, created_at, expires_at, ip, ua) VALUES (?,?,?,?,?,?)')
    .bind(id, userId, now, now + SESSION_TTL_MS, ip, ua.slice(0, 256))
    .run();
  return id;
}

/** Resolve the current user from a cookie value. Returns null if missing/expired/disabled. */
export async function resolveSession(db: D1Database, cookieVal: string | undefined): Promise<AuthedUser | null> {
  if (!cookieVal || cookieVal.length !== 64) return null; // 32 bytes hex
  const s = await db.prepare('SELECT * FROM sessions WHERE id = ?').bind(cookieVal).first<SessionRow>();
  if (!s) return null;
  if (s.expires_at < Date.now()) {
    await destroySession(db, cookieVal);
    return null;
  }
  const u = await getUserById(db, s.user_id);
  if (!u || u.disabled) return null;
  return { id: u.id, email: u.email, name: u.name, role: u.role };
}

export async function destroySession(db: D1Database, cookieVal: string): Promise<void> {
  await db.prepare('DELETE FROM sessions WHERE id = ?').bind(cookieVal).run();
}

/** Delete all sessions for a user (e.g. on password change / disable). */
export async function destroyUserSessions(db: D1Database, userId: string): Promise<void> {
  await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run();
}

/** List a user's active sessions (for the "sessions" panel). */
export async function listUserSessions(db: D1Database, userId: string): Promise<SessionRow[]> {
  const r = await db
    .prepare('SELECT * FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY created_at DESC')
    .bind(userId, Date.now())
    .all<SessionRow>();
  return r.results;
}

/** Serialize the Set-Cookie header value for a new/cleared session. */
export function sessionCookie(value: string, secure: boolean, maxAgeSec?: number): string {
  const parts = [
    `${COOKIE_NAME}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (secure) parts.push('Secure');
  if (maxAgeSec !== undefined) parts.push(`Max-Age=${maxAgeSec}`);
  return parts.join('; ');
}

export const SESSION_MAX_AGE_SEC = Math.floor(SESSION_TTL_MS / 1000);

// ── RBAC ──────────────────────────────────────────────────────────────────────
export type Role = 'owner' | 'editor' | 'viewer';
const RANK: Record<Role, number> = { viewer: 1, editor: 2, owner: 3 };

/** True if `user` has at least the `required` role. */
export function hasRole(user: AuthedUser | null, required: Role): boolean {
  if (!user) return false;
  return RANK[user.role] >= RANK[required];
}

/**
 * Capability map — the single source of truth for what each role may do.
 * Split per action (codex fix): editors edit + publish, but rollback (rewriting live to an
 * older state) and user/settings management are owner-only destructive powers.
 */
export const CAN = {
  viewContent: (u: AuthedUser | null) => hasRole(u, 'viewer'),
  editContent: (u: AuthedUser | null) => hasRole(u, 'editor'),
  publish: (u: AuthedUser | null) => hasRole(u, 'editor'),
  rollback: (u: AuthedUser | null) => hasRole(u, 'owner'),
  manageUsers: (u: AuthedUser | null) => hasRole(u, 'owner'),
  viewAudit: (u: AuthedUser | null) => hasRole(u, 'editor'),
  editSettings: (u: AuthedUser | null) => hasRole(u, 'owner'),
} as const;
