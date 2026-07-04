import type { APIRoute } from 'astro';
import { CAN, type AuthedUser } from '../../lib/session';
import { getTranslateSettingsPublic, saveTranslateSettings, saveTranslateKey } from '../../lib/settings-store';
import { audit, type D1Database } from '../../lib/db';

export const prerender = false;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function ctx(locals: any) {
  const user = locals.user as AuthedUser | null;
  const env = locals.runtime?.env as (Record<string, string | undefined> & { CMS_DB?: D1Database; CMS_KV?: any }) | undefined;
  return { user, env, db: env?.CMS_DB, kv: env?.CMS_KV };
}

// GET → current NON-SECRET config + whether a key is set (never the key itself).
export const GET: APIRoute = async ({ locals }) => {
  const { user, env, db, kv } = ctx(locals);
  if (!user || !CAN.editSettings(user)) return json({ error: 'ไม่มีสิทธิ์' }, 403);
  if (!db) return json({ error: 'ระบบยังไม่พร้อม' }, 503);
  return json(await getTranslateSettingsPublic(db, kv, env), 200);
};

// POST → save provider/baseUrl/model (non-secret) and, if provided, the API key (write-only).
export const POST: APIRoute = async ({ request, locals }) => {
  const { user, db, kv } = ctx(locals);
  if (!user || !CAN.editSettings(user)) return json({ error: 'ไม่มีสิทธิ์ตั้งค่า' }, 403);
  if (!db) return json({ error: 'ระบบยังไม่พร้อม' }, 503);

  let body: any;
  try { body = await request.json(); } catch { return json({ error: 'ข้อมูลไม่ถูกต้อง' }, 400); }

  const provider = body?.provider ? String(body.provider) : undefined;
  if (provider && !['openrouter', 'maxplus', 'custom'].includes(provider)) {
    return json({ error: 'ผู้ให้บริการไม่ถูกต้อง' }, 400);
  }
  await saveTranslateSettings(db, {
    provider,
    baseUrl: body?.baseUrl !== undefined ? String(body.baseUrl) : undefined,
    model: body?.model !== undefined ? String(body.model) : undefined,
  }, Date.now());

  // apiKey: only touch it when the field is present. Empty string clears it.
  if (typeof body?.apiKey === 'string' && body.apiKey.length > 0) {
    await saveTranslateKey(kv, body.apiKey);
  }

  await audit(db, { actorId: user.id, actorEmail: user.email, action: 'settings_translate' });
  return json({ ok: true }, 200);
};
