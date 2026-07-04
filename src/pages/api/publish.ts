import type { APIRoute } from 'astro';
import { publish, clearDraft } from '../../lib/content-store';
import { audit, type D1Database } from '../../lib/db';
import { CAN, type AuthedUser } from '../../lib/session';

export const prerender = false;

const MAX_BODY = 512 * 1024; // 512 KB cap before parse (DoS guard)

// Render-safety budget for the published snapshot (defense-in-depth; validateSnapshot
// checks shape, this constrains the values that land in <head>/HTML).
const MAX_JSON_DEPTH = 12; // reject pathologically nested payloads (DoS)
const MAX_NODES = 4000; // breadth cap: total values across the tree
const MAX_ARRAY_LEN = 200; // no single array may exceed this
// Any string that STARTS with a dangerous URI scheme (after trimming leading
// whitespace/control chars). Blocks javascript:/data:/vbscript: in href/src fields —
// which an angle-bracket filter alone does NOT stop.
const DANGEROUS_URI = /^[\u0000-\u0020]*(?:javascript|data|vbscript)\s*:/i;

/**
 * One recursive pass over the snapshot that enforces the render-safety budget:
 *  - depth ≤ MAX_JSON_DEPTH (deep-nesting DoS)
 *  - total node count ≤ MAX_NODES and every array ≤ MAX_ARRAY_LEN (breadth DoS)
 *  - no string value uses a dangerous URI scheme (javascript:/data:/vbscript:),
 *    since URL-context fields (href/src) bypass the angle-bracket text filter.
 * Returns an error string, or null when the whole tree is safe.
 */
function scanTree(v: unknown, depth: number, count: { n: number }): string | null {
  if (depth > MAX_JSON_DEPTH) return 'nesting too deep';
  if (++count.n > MAX_NODES) return 'too many nodes';
  if (typeof v === 'string') {
    if (DANGEROUS_URI.test(v)) return 'dangerous URI scheme';
    return null;
  }
  if (Array.isArray(v)) {
    if (v.length > MAX_ARRAY_LEN) return 'array too long';
    for (const x of v) { const e = scanTree(x, depth + 1, count); if (e) return e; }
    return null;
  }
  if (v && typeof v === 'object') {
    for (const x of Object.values(v)) { const e = scanTree(x, depth + 1, count); if (e) return e; }
    return null;
  }
  return null;
}

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

  // Render-safety budget: reject DoS-shaped or dangerous-URI payloads before publish.
  const scanErr = scanTree(body.snapshot, 0, { n: 0 });
  if (scanErr) {
    await audit(db, { actorId: user.id, actorEmail: user.email, action: 'publish.reject', detail: `unsafe payload: ${scanErr}` });
    return json({ error: 'unsafe payload', detail: scanErr }, 422);
  }

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
