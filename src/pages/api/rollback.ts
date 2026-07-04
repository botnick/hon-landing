import type { APIRoute } from 'astro';
import { rollback } from '../../lib/content-store';
import { audit, type D1Database } from '../../lib/db';
import { CAN, type AuthedUser } from '../../lib/session';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  const user = (locals as any).user as AuthedUser | null;
  if (!user || !CAN.rollback(user)) return json({ error: 'forbidden' }, 403);

  const env = (locals as any).runtime?.env as { CMS_DB?: D1Database; CMS_KV?: any } | undefined;
  const db = env?.CMS_DB;
  if (!db) return json({ error: 'no database binding' }, 503);

  let body: { version?: number };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid JSON' }, 400);
  }
  const v = Number(body.version);
  if (!Number.isInteger(v) || v < 1) return json({ error: 'bad version' }, 400);

  const result = await rollback(db, env?.CMS_KV, v, { authorId: user.id, authorEmail: user.email });
  if (!result.ok) return json({ error: 'rollback failed', details: result.errors }, 422);

  await audit(db, { actorId: user.id, actorEmail: user.email, action: 'rollback', target: `→v${v}`, detail: `new v${result.version}` });
  return json({ ok: true, version: result.version }, 200);
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
