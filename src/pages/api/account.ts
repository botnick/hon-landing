import type { APIRoute } from 'astro';
import { getUserById, audit, type D1Database } from '../../lib/db';
import { hashPassword, verifyPassword } from '../../lib/crypto';
import { destroyUserSessions, createSession, sessionCookie, SESSION_MAX_AGE_SEC } from '../../lib/session';
import type { AuthedUser } from '../../lib/session';

export const prerender = false;

function json(body: unknown, status: number, cookie?: string): Response {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (cookie) headers['set-cookie'] = cookie;
  return new Response(JSON.stringify(body), { status, headers });
}

// POST /api/account  { action: 'changepw', currentPassword, newPassword }
export const POST: APIRoute = async ({ request, locals }) => {
  const user = (locals as any).user as AuthedUser | null;
  if (!user) return json({ error: 'unauthorized' }, 401);
  const env = (locals as any).runtime?.env as { CMS_DB?: D1Database; COOKIE_SECURE?: string } | undefined;
  const db = env?.CMS_DB;
  if (!db) return json({ error: 'no database binding' }, 503);

  let body: any;
  try { body = await request.json(); } catch { return json({ error: 'invalid JSON' }, 400); }

  if (body.action === 'changepw') {
    const current = String(body.currentPassword || '');
    const next = String(body.newPassword || '');
    if (next.length < 10) return json({ error: 'รหัสผ่านใหม่ต้องยาวอย่างน้อย 10 ตัวอักษร' }, 400);
    const row = await getUserById(db, user.id);
    if (!row || !(await verifyPassword(current, row.pass_hash))) return json({ error: 'รหัสผ่านปัจจุบันไม่ถูกต้อง' }, 403);
    const hash = await hashPassword(next);
    await db.prepare('UPDATE users SET pass_hash=?, updated_at=? WHERE id=?').bind(hash, Date.now(), user.id).run();
    // Invalidate all sessions, then issue a fresh one so the current tab stays signed in.
    await destroyUserSessions(db, user.id);
    const sid = await createSession(db, user.id, request.headers.get('cf-connecting-ip') || '', request.headers.get('user-agent') || '');
    await audit(db, { actorId: user.id, actorEmail: user.email, action: 'account.changepw' });
    const secure = (env?.COOKIE_SECURE ?? 'true') !== 'false';
    return json({ ok: true }, 200, sessionCookie(sid, secure, SESSION_MAX_AGE_SEC));
  }

  return json({ error: 'unknown action' }, 400);
};
