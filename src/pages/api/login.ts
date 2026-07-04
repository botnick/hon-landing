import type { APIRoute } from 'astro';
import { getUserByEmail, audit, type D1Database } from '../../lib/db';
import { verifyPassword } from '../../lib/crypto';
import { createSession, sessionCookie, SESSION_MAX_AGE_SEC } from '../../lib/session';
import { checkLock, recordFail, clearFails } from '../../lib/ratelimit';

export const prerender = false;

function clientIp(request: Request): string {
  return request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || '';
}

export const POST: APIRoute = async ({ request, locals, url }) => {
  const env = (locals as any).runtime?.env as { CMS_DB?: D1Database; COOKIE_SECURE?: string } | undefined;
  const db = env?.CMS_DB;
  if (!db) {
    return json({ error: 'server not configured (no database binding)' }, 503);
  }

  let email = '';
  let password = '';
  const ct = request.headers.get('content-type') || '';
  try {
    if (ct.includes('application/json')) {
      const body = (await request.json()) as { email?: string; password?: string };
      email = String(body.email ?? '');
      password = String(body.password ?? '');
    } else {
      const form = await request.formData();
      email = String(form.get('email') ?? '');
      password = String(form.get('password') ?? '');
    }
  } catch {
    return json({ error: 'bad request' }, 400);
  }

  email = email.trim().toLowerCase();
  if (!email || !password || email.length > 320 || password.length > 1024) {
    return json({ error: 'กรุณากรอกอีเมลและรหัสผ่าน' }, 400);
  }

  const ip = clientIp(request);
  // Rate-limit by BOTH email and ip; either being locked blocks.
  for (const id of [`email:${email}`, `ip:${ip}`]) {
    if (!id.endsWith(':')) {
      const { locked, retryAfterSec } = await checkLock(db, id);
      if (locked) {
        await audit(db, { actorEmail: email, action: 'login.locked', detail: id, ip });
        return json({ error: `ลองเข้าระบบผิดหลายครั้ง กรุณารออีก ${retryAfterSec} วินาที` }, 429);
      }
    }
  }

  const user = await getUserByEmail(db, email);
  // Always run a verify to keep timing uniform even when the user is missing.
  const ok = user && !user.disabled ? await verifyPassword(password, user.pass_hash) : await verifyPassword(password, 'pbkdf2$100000$AAAA$AAAA');

  if (!user || user.disabled || !ok) {
    await recordFail(db, `email:${email}`);
    if (ip) await recordFail(db, `ip:${ip}`);
    await audit(db, { actorEmail: email, action: 'login.fail', ip });
    return json({ error: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' }, 401);
  }

  // Success
  await clearFails(db, `email:${email}`);
  if (ip) await clearFails(db, `ip:${ip}`);
  const sid = await createSession(db, user.id, ip, request.headers.get('user-agent') || '');
  await db.prepare('UPDATE users SET last_login=? WHERE id=?').bind(Date.now(), user.id).run();
  await audit(db, { actorId: user.id, actorEmail: user.email, action: 'login.ok', ip });

  const secure = (env?.COOKIE_SECURE ?? 'true') !== 'false';
  const nextParam = url.searchParams.get('next');
  const dest = nextParam && nextParam.startsWith('/admin') ? nextParam : '/admin';

  return new Response(JSON.stringify({ ok: true, redirect: dest }), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'set-cookie': sessionCookie(sid, secure, SESSION_MAX_AGE_SEC),
    },
  });
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
