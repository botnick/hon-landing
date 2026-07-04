import type { APIRoute } from 'astro';
import { publish, clearDraft } from '../../lib/content-store';
import { audit, type D1Database } from '../../lib/db';
import { CAN, type AuthedUser } from '../../lib/session';

export const prerender = false;

const MAX_BODY = 512 * 1024; // 512 KB cap before parse (DoS guard)

export const POST: APIRoute = async ({ request, locals }) => {
  const user = (locals as any).user as AuthedUser | null;
  const env = (locals as any).runtime?.env as
    | { CMS_DB?: D1Database; CMS_KV?: any; CF_ZONE_ID?: string; CF_API_TOKEN?: string }
    | undefined;
  const db = env?.CMS_DB;

  // AuthN handled by middleware; enforce AuthZ (publish = editor+) here.
  if (!user || !CAN.publish(user)) {
    return json({ error: 'forbidden' }, 403);
  }
  if (!db) return json({ error: 'no database binding' }, 503);

  // Size cap BEFORE parsing.
  const raw = await request.text();
  if (raw.length > MAX_BODY) return json({ error: 'payload too large' }, 413);

  let body: { snapshot?: unknown; note?: string; baseVersion?: number | null };
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: 'invalid JSON' }, 400);
  }
  if (!body.snapshot) return json({ error: 'snapshot required' }, 400);

  const result = await publish(
    db,
    env?.CMS_KV,
    body.snapshot,
    {
      note: String(body.note ?? '').slice(0, 500),
      authorId: user.id,
      authorEmail: user.email,
      baseVersion: typeof body.baseVersion === 'number' ? body.baseVersion : null,
    },
    { zoneId: env?.CF_ZONE_ID, apiToken: env?.CF_API_TOKEN },
  );

  if (!result.ok) {
    await audit(db, { actorId: user.id, actorEmail: user.email, action: 'publish.reject', detail: (result.errors ?? []).slice(0, 3).join('; ') });
    return json({ error: 'validation failed', details: result.errors }, 422);
  }

  // Draft is now published — clear it so the "unpublished draft" badge disappears.
  await clearDraft(env?.CMS_KV);
  await audit(db, { actorId: user.id, actorEmail: user.email, action: 'publish', target: `v${result.version}`, detail: String(body.note ?? '').slice(0, 120) });
  return json({ ok: true, version: result.version }, 200);
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
