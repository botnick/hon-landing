/**
 * Login rate-limit backed by D1 (login_attempts). Locks an identifier (email or IP)
 * after too many failures within a window. Prevents brute force without extra infra.
 */
import type { D1Database } from './db';

const MAX_FAILS = 8;
const WINDOW_MS = 15 * 60 * 1000; // 15 min
const LOCK_MS = 15 * 60 * 1000; // lock 15 min once tripped

interface AttemptRow {
  id: string;
  count: number;
  first_at: number;
  locked_until: number;
}

/** Returns { locked, retryAfterSec }. Call before checking the password. */
export async function checkLock(db: D1Database, id: string): Promise<{ locked: boolean; retryAfterSec: number }> {
  const row = await db.prepare('SELECT * FROM login_attempts WHERE id = ?').bind(id).first<AttemptRow>();
  if (!row) return { locked: false, retryAfterSec: 0 };
  if (row.locked_until > Date.now()) {
    return { locked: true, retryAfterSec: Math.ceil((row.locked_until - Date.now()) / 1000) };
  }
  return { locked: false, retryAfterSec: 0 };
}

/** Record a failed attempt; lock the identifier if it exceeds the threshold. */
export async function recordFail(db: D1Database, id: string): Promise<void> {
  const now = Date.now();
  const row = await db.prepare('SELECT * FROM login_attempts WHERE id = ?').bind(id).first<AttemptRow>();
  if (!row || now - row.first_at > WINDOW_MS) {
    // fresh window
    await db
      .prepare(
        'INSERT INTO login_attempts (id, count, first_at, locked_until) VALUES (?,1,?,0) ' +
          'ON CONFLICT(id) DO UPDATE SET count=1, first_at=?, locked_until=0',
      )
      .bind(id, now, now)
      .run();
    return;
  }
  const count = row.count + 1;
  const lockedUntil = count >= MAX_FAILS ? now + LOCK_MS : 0;
  await db
    .prepare('UPDATE login_attempts SET count=?, locked_until=? WHERE id=?')
    .bind(count, lockedUntil, id)
    .run();
}

/** Clear attempts on a successful login. */
export async function clearFails(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM login_attempts WHERE id = ?').bind(id).run();
}
