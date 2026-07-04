import type { APIRoute } from 'astro';
import { destroySession, sessionCookie, COOKIE_NAME } from '../../lib/session';
import { audit, type D1Database } from '../../lib/db';

export const prerender = false;

export const POST: APIRoute = async ({ locals, cookies, request }) => {
  const env = (locals as any).runtime?.env as { CMS_DB?: D1Database; COOKIE_SECURE?: string } | undefined;
  const db = env?.CMS_DB;
  const sid = cookies.get(COOKIE_NAME)?.value;
  const user = (locals as any).user;
  if (db && sid) {
    await destroySession(db, sid);
    await audit(db, { actorId: user?.id, actorEmail: user?.email, action: 'logout' });
  }
  const secure = (env?.COOKIE_SECURE ?? 'true') !== 'false';
  return new Response(JSON.stringify({ ok: true, redirect: '/login' }), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      // Clear the cookie (Max-Age=0)
      'set-cookie': sessionCookie('', secure, 0),
    },
  });
};
