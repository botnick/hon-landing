import type { APIRoute } from 'astro';
import { readDraft, writeDraft, clearDraft } from '../../lib/content-store';
import { CAN, type AuthedUser } from '../../lib/session';
import { audit, type D1Database } from '../../lib/db';

export const prerender = false;

// The shared working draft (not live). GET load · POST save · DELETE discard.
// Editing rights are required for all of it (viewers can't save drafts).

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function ctx(locals: any) {
  const user = locals.user as AuthedUser | null;
  const env = locals.runtime?.env as { CMS_DB?: D1Database; CMS_KV?: any } | undefined;
  return { user, db: env?.CMS_DB, kv: env?.CMS_KV };
}

export const GET: APIRoute = async ({ locals }) => {
  const { user, kv } = ctx(locals);
  if (!user || !CAN.viewContent(user)) return json({ error: 'ไม่มีสิทธิ์' }, 403);
  const draft = await readDraft(kv);
  return json({ draft }, 200);
};

export const POST: APIRoute = async ({ request, locals }) => {
  const { user, db, kv } = ctx(locals);
  if (!user || !CAN.editContent(user)) return json({ error: 'ไม่มีสิทธิ์บันทึกร่าง' }, 403);
  let body: any;
  try { body = await request.json(); } catch { return json({ error: 'ข้อมูลไม่ถูกต้อง' }, 400); }
  if (!body?.snapshot) return json({ error: 'ไม่มีเนื้อหาให้บันทึก' }, 400);
  const res = await writeDraft(kv, body.snapshot, user.name || user.email);
  if (!res.ok) return json({ error: 'บันทึกร่างไม่สำเร็จ', details: res.errors }, 422);
  if (db) await audit(db, { actorId: user.id, actorEmail: user.email, action: 'draft_save' });
  return json({ ok: true, savedAt: Date.now(), savedBy: user.name || user.email }, 200);
};

export const DELETE: APIRoute = async ({ locals }) => {
  const { user, db, kv } = ctx(locals);
  if (!user || !CAN.editContent(user)) return json({ error: 'ไม่มีสิทธิ์' }, 403);
  await clearDraft(kv);
  if (db) await audit(db, { actorId: user.id, actorEmail: user.email, action: 'draft_discard' });
  return json({ ok: true }, 200);
};
