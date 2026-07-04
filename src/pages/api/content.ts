import type { APIRoute } from 'astro';
import { readLive, readVersion, currentLiveVersion } from '../../lib/content-store';
import { CAN, type AuthedUser } from '../../lib/session';
import type { D1Database } from '../../lib/db';

export const prerender = false;

// GET /api/content            → current live snapshot (or latest version) for editing
// GET /api/content?version=N  → a specific version's snapshot (for diff / preview)
export const GET: APIRoute = async ({ request, locals }) => {
  const user = (locals as any).user as AuthedUser | null;
  if (!user || !CAN.viewContent(user)) return json({ error: 'forbidden' }, 403);

  const env = (locals as any).runtime?.env as { CMS_DB?: D1Database; CMS_KV?: any } | undefined;
  const db = env?.CMS_DB;
  if (!db) return json({ error: 'no database binding' }, 503);

  const url = new URL(request.url);
  const vParam = url.searchParams.get('version');

  if (vParam) {
    const v = Number(vParam);
    if (!Number.isInteger(v) || v < 1) return json({ error: 'bad version' }, 400);
    const snap = await readVersion(db, v);
    if (!snap) return json({ error: 'not found' }, 404);
    return json({ version: v, snapshot: snap }, 200);
  }

  // Default: live snapshot from KV, else latest D1 version.
  let snap = await readLive(env?.CMS_KV);
  const live = await currentLiveVersion(db);
  if (!snap && live) snap = await readVersion(db, live);
  return json({ version: live, snapshot: snap }, 200);
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
