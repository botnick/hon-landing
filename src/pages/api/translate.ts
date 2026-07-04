import type { APIRoute } from 'astro';
import { CAN, type AuthedUser } from '../../lib/session';
import { resolveTranslateConfig, translateBatch } from '../../lib/translate';
import { getTranslateSettings } from '../../lib/settings-store';
import type { D1Database } from '../../lib/db';

export const prerender = false;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

// POST /api/translate  { texts: string[], context?: string }  → { translations: string[] }
// Server-side only so the provider API key never touches the browser.
export const POST: APIRoute = async ({ request, locals }) => {
  const user = (locals as any).user as AuthedUser | null;
  if (!user || !CAN.editContent(user)) return json({ error: 'ไม่มีสิทธิ์ใช้งานการแปล' }, 403);

  const env = (locals as any).runtime?.env as (Record<string, string | undefined> & { CMS_DB?: D1Database; CMS_KV?: any }) | undefined;
  const db = env?.CMS_DB;

  let body: { texts?: unknown; context?: string };
  try { body = await request.json(); } catch { return json({ error: 'ข้อมูลไม่ถูกต้อง' }, 400); }
  const texts = Array.isArray(body?.texts) ? body.texts.map((t) => String(t ?? '')) : null;
  if (!texts) return json({ error: 'ไม่มีข้อความให้แปล' }, 400);
  if (texts.length > 200) return json({ error: 'ข้อความมากเกินไป (สูงสุด 200 ช่องต่อครั้ง)' }, 400);

  // Non-secret provider/model/baseUrl come from admin settings (D1); the KEY comes from KV
  // (write-only, set in Settings) or the env secret TRANSLATE_API_KEY.
  const settings = db ? await getTranslateSettings(db, env?.CMS_KV) : null;
  const cfg = resolveTranslateConfig(env, settings ?? undefined);
  if (!cfg) {
    return json({ error: 'ยังไม่ได้ตั้งค่า AI แปลภาษา — ไปที่ “ตั้งค่า” เพื่อเลือกผู้ให้บริการและใส่คีย์' }, 503);
  }

  const result = await translateBatch(cfg, texts, { context: body?.context });
  if (!result.ok) return json({ error: result.error || 'แปลไม่สำเร็จ' }, 502);
  return json({ translations: result.translations }, 200);
};
