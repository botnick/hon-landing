import type { APIRoute } from 'astro';
import { getUserByEmail, getUserById, audit, type D1Database } from '../../lib/db';
import { hashPassword, randomId } from '../../lib/crypto';
import { destroyUserSessions } from '../../lib/session';
import { CAN, type AuthedUser, type Role } from '../../lib/session';

export const prerender = false;

const ROLES: Role[] = ['owner', 'editor', 'viewer'];

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

// POST /api/users  { action: 'create'|'update'|'disable'|'enable'|'delete'|'resetpw', ... }
export const POST: APIRoute = async ({ request, locals }) => {
  const actor = (locals as any).user as AuthedUser | null;
  if (!actor || !CAN.manageUsers(actor)) return json({ error: 'ไม่มีสิทธิ์ทำรายการนี้' }, 403);
  const db = (locals as any).db as D1Database | undefined;
  if (!db) return json({ error: 'no database binding' }, 503);

  let body: any;
  try { body = await request.json(); } catch { return json({ error: 'invalid JSON' }, 400); }
  const action = String(body.action || '');
  const now = Date.now();

  if (action === 'create') {
    const email = String(body.email || '').trim().toLowerCase();
    const name = String(body.name || '').slice(0, 120);
    const role = body.role as Role;
    const password = String(body.password || '');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'อีเมลไม่ถูกต้อง' }, 400);
    if (!ROLES.includes(role)) return json({ error: 'สิทธิ์ไม่ถูกต้อง' }, 400);
    if (password.length < 10) return json({ error: 'รหัสผ่านต้องยาวอย่างน้อย 10 ตัวอักษร' }, 400);
    if (await getUserByEmail(db, email)) return json({ error: 'อีเมลนี้มีอยู่แล้ว' }, 409);
    const id = randomId(16);
    const hash = await hashPassword(password);
    await db.prepare('INSERT INTO users (id,email,name,role,pass_hash,disabled,created_at,updated_at) VALUES (?,?,?,?,?,0,?,?)')
      .bind(id, email, name, role, hash, now, now).run();
    await audit(db, { actorId: actor.id, actorEmail: actor.email, action: 'user.create', target: email, detail: `role=${role}` });
    return json({ ok: true, id }, 200);
  }

  const targetId = String(body.id || '');
  const target = targetId ? await getUserById(db, targetId) : null;
  if (!target) return json({ error: 'ไม่พบผู้ใช้นี้' }, 404);

  // Guard: never let the last owner be demoted/disabled/deleted (lock-out prevention).
  const owners = (await db.prepare("SELECT COUNT(*) AS c FROM users WHERE role='owner' AND disabled=0").first<{ c: number }>())?.c ?? 0;
  const isLastOwner = target.role === 'owner' && owners <= 1;

  if (action === 'update') {
    const role = body.role as Role;
    const name = body.name != null ? String(body.name).slice(0, 120) : target.name;
    if (role && !ROLES.includes(role)) return json({ error: 'สิทธิ์ไม่ถูกต้อง' }, 400);
    if (isLastOwner && role && role !== 'owner') return json({ error: 'ลดสิทธิ์เจ้าของคนสุดท้ายไม่ได้' }, 400);
    await db.prepare('UPDATE users SET role=?, name=?, updated_at=? WHERE id=?')
      .bind(role || target.role, name, now, target.id).run();
    if (role && role !== target.role) await destroyUserSessions(db, target.id); // role change → re-auth
    await audit(db, { actorId: actor.id, actorEmail: actor.email, action: 'user.update', target: target.email, detail: role ? `role=${role}` : 'profile' });
    return json({ ok: true }, 200);
  }

  if (action === 'disable' || action === 'enable') {
    if (action === 'disable' && isLastOwner) return json({ error: 'ปิดใช้งานเจ้าของคนสุดท้ายไม่ได้' }, 400);
    await db.prepare('UPDATE users SET disabled=?, updated_at=? WHERE id=?').bind(action === 'disable' ? 1 : 0, now, target.id).run();
    if (action === 'disable') await destroyUserSessions(db, target.id);
    await audit(db, { actorId: actor.id, actorEmail: actor.email, action: `user.${action}`, target: target.email });
    return json({ ok: true }, 200);
  }

  if (action === 'delete') {
    if (isLastOwner) return json({ error: 'ลบเจ้าของคนสุดท้ายไม่ได้' }, 400);
    if (target.id === actor.id) return json({ error: 'ลบบัญชีตัวเองไม่ได้' }, 400);
    await db.prepare('DELETE FROM users WHERE id=?').bind(target.id).run();
    await audit(db, { actorId: actor.id, actorEmail: actor.email, action: 'user.delete', target: target.email });
    return json({ ok: true }, 200);
  }

  if (action === 'resetpw') {
    const password = String(body.password || '');
    if (password.length < 10) return json({ error: 'รหัสผ่านต้องยาวอย่างน้อย 10 ตัวอักษร' }, 400);
    const hash = await hashPassword(password);
    await db.prepare('UPDATE users SET pass_hash=?, updated_at=? WHERE id=?').bind(hash, now, target.id).run();
    await destroyUserSessions(db, target.id);
    await audit(db, { actorId: actor.id, actorEmail: actor.email, action: 'user.resetpw', target: target.email });
    return json({ ok: true }, 200);
  }

  return json({ error: 'unknown action' }, 400);
};
